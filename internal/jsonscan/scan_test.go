package jsonscan

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestObjectSpans(t *testing.T) {
	input := ` {"model":"x","in\u0070ut":{"x":["a\\\"b",-1.2e+3,true,null]},"input":"last"} `
	spans, e := Object(strings.NewReader(input))
	if e != nil {
		t.Fatal(e)
	}
	if len(spans) != 3 || spans[1].Key != "input" || input[spans[1].Start:spans[1].End] != `{"x":["a\\\"b",-1.2e+3,true,null]}` || spans[2].Key != "input" {
		t.Fatalf("%+v", spans)
	}
}
func TestSyntaxMatchesJSON(t *testing.T) {
	cases := []string{`{}`, `{"a":[]}`, `{"a":[1,2,3]}`, `{"a":"\ud800"}`, `{"a":-0.2E+2}`, `{"a":01}`, `{"a":1.}`, `{"a":1e}`, `{"a":"\x00"}`, `{"a":"\u123"}`, `{"a":true} null`, `{"a": [1,]}`, `{"a": {"b":1,}}`, `{"a":"abc`}
	for _, v := range cases {
		_, e := Object(strings.NewReader(v))
		if (e == nil) != json.Valid([]byte(v)) {
			t.Errorf("%q err %v", v, e)
		}
	}
}
func TestLargeValueBounded(t *testing.T) {
	r := ioMulti(`{"input":"`, strings.NewReader(strings.Repeat("x", 8<<20)), `"}`)
	s, e := Object(r)
	if e != nil || len(s) != 1 || s[0].End-s[0].Start != (8<<20)+2 {
		t.Fatalf("%+v %v", s, e)
	}
}

func FuzzObjectSyntax(f *testing.F) {
	for _, s := range []string{`{}`, `{"a":[1,"x\\y",{"n":null}]}`, `{"a":"\u1234"}`, `{"a":1} {}`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if len(s) > 65536 {
			return
		}
		_, err := Object(strings.NewReader(s))
		valid := json.Valid([]byte(s))
		if valid {
			valid = strings.HasPrefix(strings.TrimSpace(s), "{")
		}
		if (err == nil) != valid {
			t.Fatalf("input %q valid %v error %v", s, valid, err)
		}
	})
}

func TestCopySpan(t *testing.T) {
	input := `{"input":{"image":"abc\\\"def","n":[0,true]},"model":"x"}`
	spans, err := Object(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err = CopySpan(&out, strings.NewReader(input), spans[0]); err != nil {
		t.Fatal(err)
	}
	if out.String() != input[spans[0].Start:spans[0].End] {
		t.Fatalf("copy mismatch: %s", out.String())
	}
}
