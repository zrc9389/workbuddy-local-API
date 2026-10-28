package upstream

import (
	"encoding/json"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
	"io"
	"os"
	"strings"
)

const responseMemoryThreshold = 256 << 10

// ResponseSpool owns all temporary files backing an aggregated response.
type ResponseSpool struct{ files []*os.File }

func (s *ResponseSpool) Close() error {
	var first error
	for _, f := range s.files {
		name := f.Name()
		if e := f.Close(); e != nil && first == nil {
			first = e
		}
		if e := os.Remove(name); e != nil && !errors.Is(e, os.ErrNotExist) && first == nil {
			first = e
		}
	}
	s.files = nil
	return first
}

type SpoolText struct {
	file *os.File
	size int64
}

func (v *SpoolText) Reader() io.Reader { return io.NewSectionReader(v.file, 0, v.size) }
func (v *SpoolText) Len() int64        { return v.size }

type responseText struct {
	store *ResponseSpool
	small strings.Builder
	file  *os.File
	size  int64
	err   error
}

func newResponseText(store *ResponseSpool) *responseText { return &responseText{store: store} }
func (b *responseText) WriteString(s string) {
	if b.err != nil {
		return
	}
	if b.store == nil || (b.file == nil && b.size+int64(len(s)) <= responseMemoryThreshold) {
		_, b.err = b.small.WriteString(s)
		b.size += int64(len(s))
		return
	}
	if b.file == nil {
		b.file, b.err = os.CreateTemp("", "wb_response_value_*.tmp")
		if b.err != nil {
			return
		}
		b.store.files = append(b.store.files, b.file)
		if b.err = b.file.Chmod(0600); b.err != nil {
			return
		}
		_, b.err = io.WriteString(b.file, b.small.String())
		b.small.Reset()
		if b.err != nil {
			return
		}
	}
	var n int
	n, b.err = io.WriteString(b.file, s)
	b.size += int64(n)
	if b.err == nil && n != len(s) {
		b.err = io.ErrShortWrite
	}
}
func (b *responseText) Len() int { return int(b.size) }
func (b *responseText) Value() any {
	if b.file == nil {
		return b.small.String()
	}
	return &SpoolText{b.file, b.size}
}
func dropTruncatedSpoolCalls(calls []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		fn, _ := call["function"].(map[string]any)
		switch v := fn["arguments"].(type) {
		case *SpoolText:
			_, err := jsonscan.Array(io.MultiReader(strings.NewReader("["), v.Reader(), strings.NewReader("]")))
			if err != nil {
				continue
			}
		case string:
			if v != "" && !json.Valid([]byte(v)) {
				continue
			}
		}
		out = append(out, call)
	}
	return out
}
