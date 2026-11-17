package usage

import (
	"encoding/json"
	"testing"
	"time"
)

// TestPointTSMsPopulationAndCrossTimezone 验证 Point.TSMs 正确生成
// 并能在 JSON 序列化中向前端透出 ts_ms 绝对毫秒时间戳，彻底断绝跨时区解析偏差。
func TestPointTSMsPopulationAndCrossTimezone(t *testing.T) {
	r := New("")
	now := time.Now()

	// 添加一条记录
	r.Add(now, "cn", "test-u1", "glm-5.2", Delta{
		PromptTokens:      100,
		HasPromptTokens:   true,
		CompletionTokens:  50,
		HasCompletion:     true,
		TotalTokens:       150,
		HasTotal:          true,
	}, true)

	snap := r.Snapshot(24, nil)
	if len(snap.Series) == 0 {
		t.Fatal("expected non-empty snap.Series")
	}

	foundHour := false
	for _, p := range snap.Series {
		if p.Scope == "hour" {
			foundHour = true
			if p.TSMs <= 0 {
				t.Fatalf("expected positive TSMs, got %d for point %v", p.TSMs, p)
			}
			// 校验 ts_ms 与当前时间的误差在合理范围（24小时内）
			diff := now.UnixMilli() - p.TSMs
			if diff < -time.Hour.Milliseconds() || diff > 25*time.Hour.Milliseconds() {
				t.Fatalf("TSMs %d out of expected range relative to now %d", p.TSMs, now.UnixMilli())
			}

			// 验证 JSON 输出携带 ts_ms 字段
			b, err := json.Marshal(p)
			if err != nil {
				t.Fatalf("json.Marshal failed: %v", err)
			}
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatalf("json.Unmarshal failed: %v", err)
			}
			if _, ok := m["ts_ms"]; !ok {
				t.Fatalf("expected ts_ms in JSON serialization: %s", string(b))
			}
		}
	}

	if !foundHour {
		t.Fatal("expected at least one hour point in snap.Series")
	}
}
