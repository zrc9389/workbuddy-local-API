package upstream

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
)

const maxCapturedMetadataBytes = 64 << 10

type metaCapturePhase int

const (
	metaPhaseNone metaCapturePhase = iota
	metaPhaseExpectColon
	metaPhaseExpectObjStart
	metaPhaseCaptureObj
	metaPhaseSkipTrailingComma
)

// rewriteLargePayload streams known blacklist fingerprints through a private
// disk file, preserving the existing memory/Spool boundary while stripping
// top-level metadata.user_id / metadata.userId consistently with sanitize.go.
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

	// 跟踪 JSON 字符串与顶层对象结构：
	// 1. 仅在字符串字面量内部执行黑名单改写，严禁破坏 JSON 裸数字（如 11128）；
	// 2. 在顶层对象（objDepth == 1, arrDepth == 0）捕获并剥离 metadata.user_id / metadata.userId。
	inString := false
	escaped := false
	objDepth := 0
	arrDepth := 0
	expectTopKey := false
	readingTopKey := false
	var topKeyBuf []byte
	var topKeyStartOffset int64 = -1
	var commaBeforeKeyOffset int64 = -1
	var lastNonWSByte byte
	var lastNonWSOffset int64 = -1

	mPhase := metaPhaseNone
	var metaObjBuf []byte
	metaObjDepth := 0
	metaInStr := false
	metaEsc := false

	isWS := func(b byte) bool {
		return b == ' ' || b == '\t' || b == '\n' || b == '\r'
	}

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

	truncateTo := func(pos int64) error {
		if err := f.Truncate(pos); err != nil {
			return err
		}
		if _, err := f.Seek(pos, io.SeekStart); err != nil {
			return err
		}
		total = pos
		return nil
	}

	sanitizeMetaValue := func(v any) any {
		var walk func(any) any
		walk = func(x any) any {
			switch t := x.(type) {
			case string:
				return sanitizeText(t)
			case map[string]any:
				for k, val := range t {
					t[k] = walk(val)
				}
				return t
			case []any:
				for i, val := range t {
					t[i] = walk(val)
				}
				return t
			default:
				return x
			}
		}
		return walk(v)
	}

	finishMetaObj := func() error {
		var meta map[string]any
		if err := json.Unmarshal(metaObjBuf, &meta); err != nil || meta == nil {
			// 非标准对象：原样落盘，不破坏流
			if werr := write(metaObjBuf); werr != nil {
				return werr
			}
			mPhase = metaPhaseNone
			metaObjBuf = nil
			expectTopKey = false
			lastNonWSByte = '}'
			lastNonWSOffset = total - 1
			return nil
		}
		delete(meta, "user_id")
		delete(meta, "userId")
		metaObjBuf = nil
		if len(meta) == 0 {
			// 与 sanitizeMetadata 一致：剥除后为空对象则一并删除 metadata 键
			if commaBeforeKeyOffset >= 0 {
				if err := truncateTo(commaBeforeKeyOffset); err != nil {
					return err
				}
				mPhase = metaPhaseNone
				expectTopKey = false
				lastNonWSByte = 0
				lastNonWSOffset = -1
			} else if topKeyStartOffset >= 0 {
				if err := truncateTo(topKeyStartOffset); err != nil {
					return err
				}
				mPhase = metaPhaseSkipTrailingComma
				expectTopKey = true
				lastNonWSByte = '{'
				lastNonWSOffset = topKeyStartOffset - 1
			} else {
				if err := write([]byte("{}")); err != nil {
					return err
				}
				mPhase = metaPhaseNone
				expectTopKey = false
			}
			return nil
		}
		sanitizeMetaValue(meta)
		cleaned, err := json.Marshal(meta)
		if err != nil {
			cleaned = []byte("{}")
		}
		if err := write(cleaned); err != nil {
			return err
		}
		mPhase = metaPhaseNone
		expectTopKey = false
		lastNonWSByte = '}'
		lastNonWSOffset = total - 1
		return nil
	}

	processByte := func(b byte) error {
		switch mPhase {
		case metaPhaseSkipTrailingComma:
			if isWS(b) {
				return nil
			}
			if b == ',' {
				mPhase = metaPhaseNone
				expectTopKey = true
				return nil
			}
			mPhase = metaPhaseNone
			expectTopKey = false
			// Fall through to process this byte (e.g. '}') normally.
		case metaPhaseCaptureObj:
			metaObjBuf = append(metaObjBuf, b)
			if metaInStr {
				if metaEsc {
					metaEsc = false
				} else if b == '\\' {
					metaEsc = true
				} else if b == '"' {
					metaInStr = false
				}
			} else {
				switch b {
				case '"':
					metaInStr = true
				case '{':
					metaObjDepth++
				case '}':
					metaObjDepth--
					if metaObjDepth == 0 {
						return finishMetaObj()
					}
				}
			}
			if len(metaObjBuf) > maxCapturedMetadataBytes {
				// 极端异常大 metadata 保护：放弃缓存直接流式落盘
				if err := write(metaObjBuf); err != nil {
					return err
				}
				metaObjBuf = nil
				objDepth += metaObjDepth
				inString = metaInStr
				escaped = metaEsc
				mPhase = metaPhaseNone
			}
			return nil
		case metaPhaseExpectColon:
			if isWS(b) {
				return write([]byte{b})
			}
			if b == ':' {
				mPhase = metaPhaseExpectObjStart
				lastNonWSByte = ':'
				lastNonWSOffset = total
				return write([]byte{b})
			}
			mPhase = metaPhaseNone
		case metaPhaseExpectObjStart:
			if isWS(b) {
				return write([]byte{b})
			}
			if b == '{' {
				mPhase = metaPhaseCaptureObj
				metaObjBuf = append(metaObjBuf[:0], '{')
				metaObjDepth = 1
				metaInStr = false
				metaEsc = false
				return nil
			}
			mPhase = metaPhaseNone
		}

		writePos := total
		if err := write([]byte{b}); err != nil {
			return err
		}
		if inString {
			if escaped {
				if readingTopKey && len(topKeyBuf) < 32 {
					topKeyBuf = append(topKeyBuf, b)
				}
				escaped = false
				return nil
			}
			if b == '\\' {
				escaped = true
				return nil
			}
			if b == '"' {
				inString = false
				if readingTopKey {
					readingTopKey = false
					if string(topKeyBuf) == "metadata" {
						mPhase = metaPhaseExpectColon
					}
				}
				lastNonWSByte = '"'
				lastNonWSOffset = writePos
				return nil
			}
			if readingTopKey && len(topKeyBuf) < 32 {
				topKeyBuf = append(topKeyBuf, b)
			}
			return nil
		}

		if isWS(b) {
			return nil
		}
		switch b {
		case '"':
			inString = true
			if objDepth == 1 && arrDepth == 0 && expectTopKey {
				readingTopKey = true
				topKeyBuf = topKeyBuf[:0]
				topKeyStartOffset = writePos
				if lastNonWSByte == ',' {
					commaBeforeKeyOffset = lastNonWSOffset
				} else {
					commaBeforeKeyOffset = -1
				}
				expectTopKey = false
			}
		case '{':
			objDepth++
			if objDepth == 1 && arrDepth == 0 {
				expectTopKey = true
			}
		case '}':
			if objDepth > 0 {
				objDepth--
			}
			expectTopKey = false
		case '[':
			arrDepth++
		case ']':
			if arrDepth > 0 {
				arrDepth--
			}
		case ',':
			if objDepth == 1 && arrDepth == 0 {
				expectTopKey = true
			}
		}
		lastNonWSByte = b
		lastNonWSOffset = writePos
		return nil
	}

	consume := func(final bool) error {
		for len(pending) >= maxPattern || (final && len(pending) > 0) {
			matched := false
			if mPhase == metaPhaseNone && inString && !escaped && !readingTopKey {
				for _, pat := range patterns {
					if len(pat[0]) <= len(pending) && bytes.Equal(pending[:len(pat[0])], pat[0]) {
						if err := write(pat[1]); err != nil {
							return err
						}
						pending = pending[len(pat[0]):]
						matched = true
						break
					}
				}
			}
			if !matched {
				b := pending[0]
				pending = pending[1:]
				if err := processByte(b); err != nil {
					return err
				}
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
	// EOF while capturing incomplete metadata object: flush raw bytes without loss
	if mPhase == metaPhaseCaptureObj && len(metaObjBuf) > 0 {
		if err := write(metaObjBuf); err != nil {
			cleanup()
			return nil, 0, nil, err
		}
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
