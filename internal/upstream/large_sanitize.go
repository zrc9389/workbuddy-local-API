package upstream

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"sort"
)

// rewriteLargePayload streams known blacklist fingerprints through a private
// disk file, preserving the existing memory/Spool boundary.
func rewriteLargePayload(src io.Reader, sanitize bool) (io.ReadCloser, int64, func(), error) {
	if !sanitize {
		return io.NopCloser(src), -1, func() {}, nil
	}
	patterns := make([][2][]byte, 0, len(sanitizeRewrites)+1)
	seenPat := make(map[string]bool, len(sanitizeRewrites)+1)
	for _, rw := range sanitizeRewrites {
		if !seenPat[rw[0]] {
			seenPat[rw[0]] = true
			patterns = append(patterns, [2][]byte{[]byte(rw[0]), []byte(rw[1])})
		}
	}
	if !seenPat["x-anthropic-billing-header"] {
		patterns = append(patterns, [2][]byte{[]byte("x-anthropic-billing-header"), []byte("x-anthropic-billing-hdr")})
	}
	sort.Slice(patterns, func(i, j int) bool { return len(patterns[i][0]) > len(patterns[j][0]) })
	maxPattern := 1
	for _, p := range patterns {
		if len(p[0]) > maxPattern {
			maxPattern = len(p[0])
		}
	}
	f, err := os.CreateTemp("", "wb_large_sanitize_*.tmp")
	if err != nil {
		return nil, 0, nil, fmt.Errorf("create large sanitize spool: %w", err)
	}
	path := f.Name()
	_ = f.Chmod(0600)
	cleanup := func() { _ = f.Close(); _ = os.Remove(path) }
	buf := make([]byte, 64<<10)
	pending := make([]byte, 0, maxPattern-1)
	var total int64
	// 跟踪 JSON 字符串字面量状态：仅在字符串内部执行替换，严禁把 JSON 裸数字 11128 篡改成非法 JSON 11-128！
	inString := false
	escaped := false
	write := func(in []byte) error {
		n, e := f.Write(in)
		total += int64(n)
		if e != nil {
			return e
		}
		if n != len(in) {
			return io.ErrShortWrite
		}
		return nil
	}
	advanceJSONState := func(b byte) {
		if inString {
			if escaped {
				escaped = false
				return
			}
			if b == '\\' {
				escaped = true
			} else if b == '"' {
				inString = false
			}
		} else if b == '"' {
			inString = true
		}
	}
	consume := func(final bool) error {
		for len(pending) >= maxPattern || (final && len(pending) > 0) {
			matched := false
			if inString && !escaped {
				for _, p := range patterns {
					if len(p[0]) <= len(pending) && bytes.Equal(pending[:len(p[0])], p[0]) {
						if err := write(p[1]); err != nil {
							return err
						}
						pending = pending[len(p[0]):]
						matched = true
						break
					}
				}
			}
			if !matched {
				b := pending[0]
				if err := write(pending[:1]); err != nil {
					return err
				}
				advanceJSONState(b)
				pending = pending[1:]
			}
		}
		return nil
	}
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			pending = append(pending, buf[:n]...)
			if err := consume(false); err != nil {
				cleanup()
				return nil, 0, nil, err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			cleanup()
			return nil, 0, nil, readErr
		}
	}
	if err := consume(true); err != nil {
		cleanup()
		return nil, 0, nil, err
	}
	if err := f.Sync(); err != nil {
		cleanup()
		return nil, 0, nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, nil, err
	}
	return f, total, cleanup, nil
}
