package upstream

import "testing"

func TestStrictHistoryRefusesSilentDeletion(t *testing.T) {
	for _, raw := range []string{`{"messages":[{"role":"tool","tool_call_id":"absent","content":"important"}]}`, `{"messages":[{"role":"assistant","tool_calls":[{"id":"call"}]}]}`, `{"messages":[{"role":"assistant","tool_calls":[{"id":"call"}]},{"role":"user","content":"retain me"},{"role":"tool","tool_call_id":"call"}]}`} {
		if ValidateStrictHistory([]byte(raw)) == nil {
			t.Fatal("silently accepted malformed history")
		}
	}
	if e := ValidateStrictHistory([]byte(`{"messages":[{"role":"assistant","tool_calls":[{"id":"call"}]},{"role":"tool","tool_call_id":"call","content":"result"},{"role":"user","content":"next"}]}`)); e != nil {
		t.Fatal(e)
	}
}
