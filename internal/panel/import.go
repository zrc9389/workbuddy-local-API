package panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/auth"
)

// importCockpit preserves the legacy multipart route while delegating all
// credential validation and persistence to the side-effect-free JSON importer.
func (p *Panel) importCockpit(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCredentialImportBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid or oversized account upload")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing account file")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxCredentialImportBytes+1))
	if err != nil || len(raw) > maxCredentialImportBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "account file exceeds size limit")
		return
	}
	canonical, err := normalizeAccountImport(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	forward := r.Clone(r.Context())
	forward.Body = io.NopCloser(bytes.NewReader(canonical))
	forward.ContentLength = int64(len(canonical))
	forward.Header = r.Header.Clone()
	forward.Header.Set("Content-Type", "application/json")
	p.AccountsImport(w, forward)
}

func normalizeAccountImport(raw []byte) ([]byte, error) {
	var root any
	if err := json.Unmarshal(bytes.TrimPrefix(bytes.TrimSpace(raw), []byte{0xEF, 0xBB, 0xBF}), &root); err != nil {
		return nil, fmt.Errorf("invalid account JSON")
	}
	var rows []any
	switch value := root.(type) {
	case []any:
		rows = value
	case map[string]any:
		for _, key := range []string{"accounts", "data", "items", "list"} {
			if wrapped, ok := value[key].([]any); ok {
				rows = wrapped
				break
			}
		}
		if rows == nil {
			rows = []any{value}
		}
	default:
		return nil, fmt.Errorf("expected account object or array")
	}
	if len(rows) == 0 || len(rows) > maxCredentialImportAccounts {
		return nil, fmt.Errorf("import requires 1 to 100 accounts")
	}
	canonical := make([]map[string]any, 0, len(rows))
	for index, value := range rows {
		row, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("account %d must be an object", index+1)
		}
		authRow, _ := row["auth"].(map[string]any)
		accountRow, _ := row["account"].(map[string]any)
		if authRow == nil {
			authRow = row
		}
		if accountRow == nil {
			accountRow = row
		}
		access := firstValue(authRow, "accessToken", "access_token")
		refresh := firstValue(authRow, "refreshToken", "refresh_token")
		uid := firstValue(accountRow, "uid", "user_id", "userId")
		if access == nil || strings.TrimSpace(fmt.Sprint(access)) == "" || uid == nil || strings.TrimSpace(fmt.Sprint(uid)) == "" {
			return nil, fmt.Errorf("account %d is missing access token or UID", index+1)
		}
		expires, err := importExpiry(firstValue(authRow, "expiresAt", "expires_at", "expire_at"))
		if err != nil {
			return nil, fmt.Errorf("account %d has invalid expiry", index+1)
		}
		domain := stringValue(firstValue(authRow, "domain"))
		realm := stringValue(firstValue(row, "realm"))
		if realm == "" {
			realm = stringValue(firstValue(authRow, "realm"))
		}
		if realm == "" {
			realm = auth.ResolveRealm("", domain)
		}
		entry := map[string]any{
			"auth":    map[string]any{"accessToken": fmt.Sprint(access), "refreshToken": stringValue(refresh), "expiresAt": expires, "domain": domain, "realm": realm},
			"account": map[string]any{"uid": fmt.Sprint(uid), "enterpriseId": stringValue(firstValue(accountRow, "enterpriseId", "enterprise_id")), "nickname": stringValue(firstValue(accountRow, "nickname", "email"))},
		}
		if proxy := firstValue(row, "proxy", "proxy_url", "proxyUrl"); proxy != nil && proxy != "" {
			entry["proxy"] = proxy
		}
		if device := firstValue(row, "device_token", "deviceToken"); device != nil && device != "" {
			entry["device_token"] = device
		}
		canonical = append(canonical, entry)
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return nil, fmt.Errorf("invalid account data")
	}
	return encoded, nil
}

func firstValue(row map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := row[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func importExpiry(value any) (int64, error) {
	if value == nil {
		return time.Now().Add(365 * 24 * time.Hour).Unix(), nil
	}
	var number float64
	switch typed := value.(type) {
	case json.Number:
		number, _ = typed.Float64()
	case float64:
		number = typed
	case string:
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
			number = parsed
		} else if when, err := time.Parse(time.RFC3339, typed); err == nil {
			return when.Unix(), nil
		} else {
			return 0, fmt.Errorf("invalid expiry")
		}
	default:
		return 0, fmt.Errorf("invalid expiry")
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number <= 0 {
		return 0, fmt.Errorf("invalid expiry")
	}
	if number >= 1e11 {
		number /= 1000
	}
	if number > float64(math.MaxInt64) {
		return 0, fmt.Errorf("invalid expiry")
	}
	return int64(number), nil
}
