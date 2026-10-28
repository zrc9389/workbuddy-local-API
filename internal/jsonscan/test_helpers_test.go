package jsonscan

import (
	"io"
	"strings"
)

func ioMulti(prefix string, value io.Reader, suffix string) io.Reader {
	return io.MultiReader(strings.NewReader(prefix), value, strings.NewReader(suffix))
}
