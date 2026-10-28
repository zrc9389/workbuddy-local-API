package server

import (
	"testing"
)

// TestHasImagePartMixedContent 验证在消息 content 为字符串、数组、或混合形态时 hasImagePart 均能准确识别
func TestHasImagePartMixedContent(t *testing.T) {
	// 1. 混合场景：第一条消息为纯文本字符串（系统指令），第二条消息为包含 image_url 的多模态数组
	// 旧版实现由于强类型 Unmarshal 会在遇到首条字符串时直接报错导致漏判
	mixedWithImage := []byte(`{
		"model": "gpt-5.6-sol",
		"messages": [
			{"role": "system", "content": "You are an intelligent visual assistant."},
			{"role": "user", "content": [
				{"type": "text", "text": "What is in this picture?"},
				{"type": "image_url", "image_url": {"url": "https://example.com/test.png"}}
			]}
		]
	}`)

	if !hasImagePart(mixedWithImage) {
		t.Fatal("hasImagePart must return true for mixed content containing image_url")
	}

	// 2. 纯文本场景（无任何 image_url）
	textOnly := []byte(`{
		"model": "gpt-5.6-sol",
		"messages": [
			{"role": "system", "content": "You are a helpful assistant."},
			{"role": "user", "content": "Hello, world!"}
		]
	}`)
	if hasImagePart(textOnly) {
		t.Fatal("hasImagePart must return false for text-only messages")
	}

	// 3. 空消息与畸形数据安全兜底
	if hasImagePart([]byte("{}")) {
		t.Fatal("empty object should return false")
	}
	if hasImagePart([]byte("invalid json")) {
		t.Fatal("invalid json should return false")
	}
}
