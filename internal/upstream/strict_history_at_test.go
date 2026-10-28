package upstream

import (
	"strings"
	"testing"
)

func TestStrictHistoryAtMatchesReader(t *testing.T) {
	cases := []string{
		`{"messages":null}`,
		`{"messages":[null]}`,
		`{"messages":[{"role":"assistant","tool_calls":[{"id":"x"}]},{"role":"tool","tool_call_id":"x"}]}`,
		`{"messages":[{"role":"assistant","role":null,"tool_calls":[{"id":"x","id":null}]},{"role":"tool","tool_call_id":"x"}]}`,
		`{"messages":[{"role":"assistant","tool_calls":[{"id":"x"}]}]}`,
		`{"messages":[{"role":"tool","tool_call_id":"x"}]}`,
		`{"messages":[{"role":3}]}`,
		`{"messages":[{"role":"assistant","tool_calls":[null]}]}`,
	}
	for _, body := range cases {
		want := ValidateStrictHistory([]byte(body))
		got := ValidateStrictHistoryAt(strings.NewReader(body), int64(len(body)))
		if (want == nil) != (got == nil) {
			t.Errorf("%s: reader=%v, ReaderAt=%v", body, want, got)
		}
	}
}
