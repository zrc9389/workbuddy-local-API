package jsonscan

import (
	"fmt"
	"io"
)

// CopySpan copies an already validated value without materializing it.
func CopySpan(dst io.Writer, src io.ReaderAt, span Span) error {
	if span.Start < 0 || span.End < span.Start {
		return fmt.Errorf("invalid JSON span")
	}
	n, err := io.CopyBuffer(dst, io.NewSectionReader(src, span.Start, span.End-span.Start), make([]byte, 32<<10))
	if err != nil {
		return err
	}
	if n != span.End-span.Start {
		return io.ErrUnexpectedEOF
	}
	return nil
}
