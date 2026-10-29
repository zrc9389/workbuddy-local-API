package usage

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

var fileFields = fieldSet("version", "saved", "buckets")
var bucketFields = fieldSet("s", "last_seen", "r", "u", "m", "x", "q", "e", "p", "c", "t", "l", "ln", "v", "vn", "cr", "cn", "ct", "ch", "cm")

func fieldSet(names ...string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, name := range names {
		m[name] = true
	}
	return m
}

// Reject ambiguous field spellings; encoding/json otherwise matches struct fields
// case-insensitively and can silently overwrite a value.
func extras(raw []byte, known map[string]bool) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, fmt.Errorf("expected JSON object")
	}
	for key := range fields {
		if known[key] {
			if bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
				return nil, fmt.Errorf("null usage field %q", key)
			}
			delete(fields, key)
			continue
		}
		if known[strings.ToLower(key)] {
			return nil, fmt.Errorf("ambiguous usage field %q", key)
		}
	}
	return fields, nil
}

func mergeExtra(value any, extra map[string]json.RawMessage) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	for key, value := range extra {
		fields[key] = value
	}
	return json.Marshal(fields)
}

type bucketJSON bucket

func (b *bucket) UnmarshalJSON(raw []byte) error {
	extra, err := extras(raw, bucketFields)
	if err != nil {
		return err
	}
	var v bucketJSON
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*b = bucket(v)
	b.Extra = extra
	return nil
}
func (b bucket) MarshalJSON() ([]byte, error) { return mergeExtra(bucketJSON(b), b.Extra) }

type fileJSON file

func (f *file) UnmarshalJSON(raw []byte) error {
	extra, err := extras(raw, fileFields)
	if err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	buckets, ok := fields["buckets"]
	if !ok || len(bytes.TrimSpace(buckets)) == 0 || bytes.TrimSpace(buckets)[0] != '[' {
		return fmt.Errorf("usage buckets must be an array")
	}
	var v fileJSON
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*f = file(v)
	f.Extra = extra
	return nil
}
func (f file) MarshalJSON() ([]byte, error) { return mergeExtra(fileJSON(f), f.Extra) }

// Reject duplicate keys at all depths before decoding into maps or structs.
func validateUniqueJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := validateValue(d); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		if err == nil {
			return fmt.Errorf("trailing JSON value")
		}
		return err
	}
	return nil
}
func validateValue(d *json.Decoder) error {
	tok, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			keyToken, err := d.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return fmt.Errorf("invalid object key")
			}
			if seen[key] {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			seen[key] = true
			if err := validateValue(d); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	case '[':
		for d.More() {
			if err := validateValue(d); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	default:
		return fmt.Errorf("unexpected delimiter")
	}
}
