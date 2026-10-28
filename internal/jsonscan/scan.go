// Package jsonscan validates JSON while locating top-level object values without
// retaining those values in memory. Offsets are byte offsets in the input.
package jsonscan

import (
	"bufio"
	"fmt"
	"io"
)

type Span struct {
	Key        string
	Start, End int64
}
type scanner struct {
	r   *bufio.Reader
	pos int64
}

// Array validates one JSON array and returns the byte span of each element.
// Element offsets are relative to the supplied reader and exclude whitespace.
func Array(r io.Reader) ([]Span, error) {
	s := scanner{r: bufio.NewReaderSize(r, 32<<10)}
	s.ws()
	if e := s.want('['); e != nil {
		return nil, e
	}
	var spans []Span
	s.ws()
	c, e := s.peek()
	if e == nil && c == ']' {
		s.take()
	} else {
		for {
			s.ws()
			start := s.pos
			if e = s.value(1); e != nil {
				return nil, e
			}
			if len(spans) >= maxContainerItems {
				return nil, fmt.Errorf("array element count exceeds limit")
			}
			spans = append(spans, Span{Start: start, End: s.pos})
			s.ws()
			c, e = s.take()
			if e != nil {
				return nil, e
			}
			if c == ']' {
				break
			}
			if c != ',' {
				return nil, fmt.Errorf("invalid array at byte %d", s.pos)
			}
		}
	}
	s.ws()
	if _, e = s.peek(); e != io.EOF {
		if e != nil {
			return nil, e
		}
		return nil, fmt.Errorf("trailing JSON at byte %d", s.pos)
	}
	return spans, nil
}

const maxContainerItems = 65536
const maxDepth = 10000
const maxKeyBytes = 64 << 10

func (s *scanner) peek() (byte, error) {
	p, e := s.r.Peek(1)
	if e != nil {
		return 0, e
	}
	return p[0], nil
}
func (s *scanner) take() (byte, error) {
	c, e := s.r.ReadByte()
	if e == nil {
		s.pos++
	}
	return c, e
}
func (s *scanner) ws() {
	for {
		c, e := s.peek()
		if e != nil || (c != ' ' && c != '\n' && c != '\r' && c != '\t') {
			return
		}
		s.take()
	}
}
func (s *scanner) want(c byte) error {
	b, e := s.take()
	if e != nil || b != c {
		return fmt.Errorf("invalid JSON at byte %d", s.pos)
	}
	return nil
}
func hex(c byte) bool { return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F' }
func (s *scanner) str(key bool) (string, error) {
	if e := s.want('"'); e != nil {
		return "", e
	}
	var raw []byte
	for {
		c, e := s.take()
		if e != nil {
			return "", fmt.Errorf("unterminated string at byte %d", s.pos)
		}
		if c == '"' {
			break
		}
		if c < 0x20 {
			return "", fmt.Errorf("invalid string at byte %d", s.pos)
		}
		if key {
			raw = append(raw, c)
			if len(raw) > maxKeyBytes {
				return "", fmt.Errorf("object key exceeds limit")
			}
		}
		if c == '\\' {
			c, e = s.take()
			if e != nil {
				return "", fmt.Errorf("invalid escape at byte %d", s.pos)
			}
			if key {
				raw = append(raw, c)
			}
			switch c {
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
			case 'u':
				for i := 0; i < 4; i++ {
					c, e = s.take()
					if e != nil || !hex(c) {
						return "", fmt.Errorf("invalid unicode escape at byte %d", s.pos)
					}
					if key {
						raw = append(raw, c)
					}
				}
			default:
				return "", fmt.Errorf("invalid escape at byte %d", s.pos)
			}
		}
	}
	if !key {
		return "", nil
	}
	return decodeKey(raw)
}
func (s *scanner) value(depth int) error {
	if depth > maxDepth {
		return fmt.Errorf("JSON nesting exceeds limit")
	}
	s.ws()
	c, e := s.peek()
	if e != nil {
		return fmt.Errorf("missing value at byte %d", s.pos)
	}
	switch c {
	case '"':
		_, e = s.str(false)
		return e
	case '{':
		s.take()
		s.ws()
		c, e = s.peek()
		if e == nil && c == '}' {
			s.take()
			return nil
		}
		for {
			s.ws()
			if _, e = s.str(false); e != nil {
				return e
			}
			s.ws()
			if e = s.want(':'); e != nil {
				return e
			}
			if e = s.value(depth + 1); e != nil {
				return e
			}
			s.ws()
			c, e = s.take()
			if e != nil {
				return e
			}
			if c == '}' {
				return nil
			}
			if c != ',' {
				return fmt.Errorf("invalid object at byte %d", s.pos)
			}
		}
	case '[':
		s.take()
		s.ws()
		c, e = s.peek()
		if e == nil && c == ']' {
			s.take()
			return nil
		}
		for {
			if e = s.value(depth + 1); e != nil {
				return e
			}
			s.ws()
			c, e = s.take()
			if e != nil {
				return e
			}
			if c == ']' {
				return nil
			}
			if c != ',' {
				return fmt.Errorf("invalid array at byte %d", s.pos)
			}
		}
	case 't':
		return s.literal("true")
	case 'f':
		return s.literal("false")
	case 'n':
		return s.literal("null")
	default:
		return s.number()
	}
}
func (s *scanner) literal(v string) error {
	for i := 0; i < len(v); i++ {
		if e := s.want(v[i]); e != nil {
			return e
		}
	}
	return nil
}
func digit(c byte) bool { return c >= '0' && c <= '9' }
func (s *scanner) number() error {
	c, e := s.peek()
	if e != nil {
		return e
	}
	if c == '-' {
		s.take()
		c, e = s.peek()
		if e != nil {
			return e
		}
	}
	if c == '0' {
		s.take()
	} else if c >= '1' && c <= '9' {
		for {
			c, e = s.peek()
			if e != nil || !digit(c) {
				break
			}
			s.take()
		}
	} else {
		return fmt.Errorf("invalid number at byte %d", s.pos)
	}
	c, e = s.peek()
	if e == nil && c == '.' {
		s.take()
		c, e = s.peek()
		if e != nil || !digit(c) {
			return fmt.Errorf("invalid fraction")
		}
		for {
			c, e = s.peek()
			if e != nil || !digit(c) {
				break
			}
			s.take()
		}
	}
	c, e = s.peek()
	if e == nil && (c == 'e' || c == 'E') {
		s.take()
		c, e = s.peek()
		if e == nil && (c == '+' || c == '-') {
			s.take()
		}
		c, e = s.peek()
		if e != nil || !digit(c) {
			return fmt.Errorf("invalid exponent")
		}
		for {
			c, e = s.peek()
			if e != nil || !digit(c) {
				break
			}
			s.take()
		}
	}
	return nil
}

// Object validates exactly one top-level object and returns ordered spans,
// including duplicate keys. Large values are never accumulated in memory.
func Object(r io.Reader) ([]Span, error) {
	s := scanner{r: bufio.NewReaderSize(r, 32<<10)}
	s.ws()
	if e := s.want('{'); e != nil {
		return nil, e
	}
	var spans []Span
	s.ws()
	c, e := s.peek()
	if e == nil && c == '}' {
		s.take()
	} else {
		for {
			s.ws()
			key, e := s.str(true)
			if e != nil {
				return nil, e
			}
			s.ws()
			if e = s.want(':'); e != nil {
				return nil, e
			}
			s.ws()
			start := s.pos
			if e = s.value(1); e != nil {
				return nil, e
			}
			if len(spans) >= maxContainerItems {
				return nil, fmt.Errorf("object field count exceeds limit")
			}
			spans = append(spans, Span{key, start, s.pos})
			s.ws()
			c, e = s.take()
			if e != nil {
				return nil, e
			}
			if c == '}' {
				break
			}
			if c != ',' {
				return nil, fmt.Errorf("invalid object at byte %d", s.pos)
			}
		}
	}
	s.ws()
	if _, e = s.peek(); e != io.EOF {
		if e != nil {
			return nil, e
		}
		return nil, fmt.Errorf("trailing JSON at byte %d", s.pos)
	}
	return spans, nil
}
