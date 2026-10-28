package jsonscan

import "encoding/json"

func decodeKey(raw []byte) (string, error) {
	var s string
	b := make([]byte, 0, len(raw)+2)
	b = append(b, '"')
	b = append(b, raw...)
	b = append(b, '"')
	err := json.Unmarshal(b, &s)
	return s, err
}
