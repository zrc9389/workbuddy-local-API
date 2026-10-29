package auth

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// ValidateProxyURL intentionally never echoes URLs or parser errors (userinfo is secret).
func ValidateProxyURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if len(raw) > 2048 {
		return errors.New("proxy URL too long")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Opaque != "" || u.Hostname() == "" {
		return errors.New("invalid proxy URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5" {
		return errors.New("proxy scheme must be http, https or socks5")
	}
	if u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return errors.New("proxy URL must not contain path, query or fragment")
	}
	if strings.ContainsAny(u.Hostname(), " \t\r\n\\") {
		return errors.New("invalid proxy host")
	}
	if p := u.Port(); p != "" {
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return errors.New("invalid proxy port")
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return errors.New("invalid proxy port")
	}
	return nil
}

// ValidateUID limits file-derived account IDs to portable, single safe path components.
func ValidateUID(uid string) error {
	if len(uid) == 0 || len(uid) > 128 {
		return errors.New("invalid account UID")
	}
	for _, c := range uid {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return errors.New("invalid account UID")
		}
	}
	u := strings.ToUpper(uid)
	if u == "CON" || u == "PRN" || u == "AUX" || u == "NUL" || len(u) == 4 && (strings.HasPrefix(u, "COM") || strings.HasPrefix(u, "LPT")) && u[3] >= '0' && u[3] <= '9' {
		return errors.New("reserved account UID")
	}
	return nil
}
func (a *Auth) ProxyURLValue() string {
	if a == nil {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ProxyURL
}

// SetProxyAndSave holds the auth lock through persistence; failed writes restore memory.
func (a *Auth) SetProxyAndSave(proxy string) error {
	if err := ValidateProxyURL(proxy); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	old := a.ProxyURL
	a.ProxyURL = strings.TrimSpace(proxy)
	if err := a.saveAtomicLocked(); err != nil {
		a.ProxyURL = old
		return errors.New("could not persist account proxy")
	}
	return nil
}
func (a *Auth) documentLocked() map[string]any {
	doc := map[string]any{"auth": map[string]any{"accessToken": a.AccessToken, "refreshToken": a.RefreshToken, "expiresAt": a.ExpiresAt, "domain": a.Domain, "realm": a.realm}, "account": map[string]any{"uid": a.UID, "enterpriseId": a.EnterpriseID, "nickname": a.Nickname}}
	if a.DeviceToken != "" {
		doc["device_token"] = a.DeviceToken
	}
	if a.ProxyURL != "" {
		doc["proxy"] = a.ProxyURL
	}
	return doc
}

// ExportJSON is credential-bearing. It must only be used by authenticated explicit exports.
func (a *Auth) ExportJSON() (json.RawMessage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	doc := a.documentLocked()
	doc["region"] = ResolveRealm(a.realm, a.Domain)
	doc["proxy_url"] = a.ProxyURL
	return json.Marshal(doc)
}
