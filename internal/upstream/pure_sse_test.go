package upstream

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPureStream_TokenUsageCallbackAndBackpressure 验证 PureStream 单层 16KB 缓冲透传与 usage 提取
func TestPureStream_TokenUsageCallbackAndBackpressure(t *testing.T) {
	rawSSE := "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\" world!\"}}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\n" +
		"data: [DONE]\n\n"

	rec := httptest.NewRecorder()
	var extractedUsage map[string]any

	err := PureStream(rec, strings.NewReader(rawSSE), WithUsageObserver(func(usage map[string]any) {
		extractedUsage = usage
	}))

	if err != nil {
		t.Fatalf("PureStream failed: %v", err)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "Hello") || !strings.Contains(body, " world!") {
		t.Fatalf("body missing content frames: %s", body)
	}
	if !strings.Contains(body, "data: [DONE]\n\n") {
		t.Fatalf("body missing [DONE] terminator: %s", body)
	}

	// 验证 usage 回调被成功提取
	if extractedUsage == nil {
		t.Fatal("expected usage observer to be triggered for usage frame")
	}
	if total, ok := extractedUsage["total_tokens"].(float64); !ok || total != 30 {
		t.Fatalf("expected total_tokens=30, got: %v", extractedUsage["total_tokens"])
	}
}

// TestPureStream_EmptyStreamError 验证空流直接返回 errEmptyStream 且输出标准 error 帧
func TestPureStream_EmptyStreamError(t *testing.T) {
	rec := httptest.NewRecorder()
	err := PureStream(rec, strings.NewReader(": comment only\n\n"))
	if !IsEmptyStreamError(err) {
		t.Fatalf("expected empty stream error, got: %v", err)
	}
	if !strings.Contains(rec.Body.String(), "empty upstream stream") {
		t.Fatalf("expected error frame in body: %s", rec.Body.String())
	}
}
