package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/linguo2625469/workbuddy2api-panel/internal/spool"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

// TestReadPayload_SmallRequestInMemory 验证小请求（<=256KB）完全保留在内存切片中，零磁盘开销
func TestReadPayload_SmallRequestInMemory(t *testing.T) {
	data := []byte(`{"model":"gpt-5.6","messages":[{"role":"user","content":"hello small payload"}]}`)
	req, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(data))

	payload, err := ReadPayload(req, 16<<20, DefaultMemoryBufferThreshold)
	if err != nil {
		t.Fatalf("ReadPayload failed: %v", err)
	}
	defer payload.Close()

	if payload.IsSpool {
		t.Fatalf("small payload (%d bytes) should NOT be spooled to disk", len(data))
	}
	if payload.Path != "" || payload.File != nil {
		t.Fatalf("small payload should have no file path or file descriptor, got path: %s", payload.Path)
	}
	if payload.Size != int64(len(data)) {
		t.Fatalf("expected payload size %d, got %d", len(data), payload.Size)
	}

	bytesOut, err := payload.Bytes()
	if err != nil {
		t.Fatalf("payload.Bytes() failed: %v", err)
	}
	if !bytes.Equal(bytesOut, data) {
		t.Fatalf("payload bytes mismatch: got %s, want %s", string(bytesOut), string(data))
	}
}

// TestReadPayload_LargeRequestSpoolsAndCleansUp 验证大请求（>256KB）溢出落盘到私有临时文件，且在 Close() 后彻底物理销毁
func TestReadPayload_LargeRequestSpoolsAndCleansUp(t *testing.T) {
	// 构造 512KB 大请求
	bigMessage := strings.Repeat("M", 512*1024)
	bigReq := `{"model":"deepseek-v4","messages":[{"role":"user","content":"` + bigMessage + `"}]}`
	data := []byte(bigReq)
	sum := sha256.Sum256(data)

	req, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(data))

	payload, err := ReadPayload(req, 16<<20, DefaultMemoryBufferThreshold)
	if err != nil {
		t.Fatalf("ReadPayload for large request failed: %v", err)
	}

	if !payload.IsSpool {
		t.Fatalf("large request (%d bytes) must be spooled to disk", len(data))
	}
	if payload.Path == "" {
		t.Fatal("spooled payload must have a non-empty file path")
	}

	tmpPath := payload.Path

	// 1. 验证临时文件确实在磁盘上存在且内容一致
	st, err := os.Stat(tmpPath)
	if err != nil {
		t.Fatalf("temporary spool file does not exist on disk: %v", err)
	}
	if st.Size() != int64(len(data)) {
		t.Fatalf("spool file size mismatch: got %d, want %d", st.Size(), len(data))
	}

	// 2. 验证流式读取的完整性（SHA256 哈希比对）
	rdr, err := payload.OpenReader()
	if err != nil {
		t.Fatalf("OpenReader failed: %v", err)
	}
	h := sha256.New()
	if _, err := io.Copy(h, rdr); err != nil {
		rdr.Close()
		t.Fatalf("read from spool file failed: %v", err)
	}
	rdr.Close()

	if hex.EncodeToString(h.Sum(nil)) != hex.EncodeToString(sum[:]) {
		t.Fatal("spool file contents corrupted, SHA256 mismatch")
	}

	// 3. 验证生命周期结束清理：调用 Close() 后临时文件必须被从磁盘彻底移除
	if err := payload.Close(); err != nil {
		t.Fatalf("payload.Close() returned error: %v", err)
	}

	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatalf("spool file %s was NOT removed after payload.Close()", tmpPath)
	}

	// 4. 验证 Close() 幂等安全
	if err := payload.Close(); err != nil {
		t.Fatalf("second Close() should be no-op, got: %v", err)
	}
}

// TestReadPayload_ExceedsMaxLimitBlocksAndCleansUp 验证超过 MaxBodyBytes 时拦截报错且不残留临时文件
func TestReadPayload_ExceedsMaxLimitBlocksAndCleansUp(t *testing.T) {
	bigData := make([]byte, 1024*1024) // 1MB
	maxLimit := int64(512 * 1024)      // 上限 512KB

	req, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(bigData))

	payload, err := ReadPayload(req, maxLimit, DefaultMemoryBufferThreshold)
	if err == nil {
		if payload != nil {
			_ = payload.Close()
		}
		t.Fatal("expected request body too large error, got nil")
	}

	if !errors.Is(err, errRequestBodyTooLarge) {
		t.Fatalf("expected errRequestBodyTooLarge, got: %v", err)
	}
}

// TestReadPayload_BoundaryThresholds 严格验证临界阈值行为：
// 1. 恰好等于 threshold（256KB）：零落盘，IsSpool=false
// 2. 恰好等于 threshold+1 字节：落盘，IsSpool=true
// 3. 恰好等于 maxBytes：成功通过
// 4. 恰好等于 maxBytes+1 字节：拦截报错且无临时文件残留
func TestReadPayload_BoundaryThresholds(t *testing.T) {
	threshold := int64(256 * 1024)
	maxLimit := int64(512 * 1024)

	// Case 1: 恰好等于 threshold (256KB)
	exactData := bytes.Repeat([]byte("A"), int(threshold))
	req1, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(exactData))
	p1, err := ReadPayload(req1, maxLimit, threshold)
	if err != nil {
		t.Fatalf("case 1 exact threshold failed: %v", err)
	}
	if p1.IsSpool {
		p1.Close()
		t.Fatalf("case 1 payload of exact threshold size (%d) should NOT be spooled", len(exactData))
	}
	if p1.Size != threshold {
		p1.Close()
		t.Fatalf("case 1 size mismatch: got %d, want %d", p1.Size, threshold)
	}
	_ = p1.Close()

	// Case 2: 恰好等于 threshold + 1 字节 (256KB + 1)
	oneOverData := bytes.Repeat([]byte("B"), int(threshold)+1)
	req2, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(oneOverData))
	p2, err := ReadPayload(req2, maxLimit, threshold)
	if err != nil {
		t.Fatalf("case 2 threshold+1 failed: %v", err)
	}
	if !p2.IsSpool {
		p2.Close()
		t.Fatalf("case 2 payload of threshold+1 size (%d) MUST be spooled", len(oneOverData))
	}
	if p2.Size != threshold+1 {
		p2.Close()
		t.Fatalf("case 2 size mismatch: got %d, want %d", p2.Size, threshold+1)
	}
	tmpPath2 := p2.Path
	if err := p2.Close(); err != nil {
		t.Fatalf("case 2 close failed: %v", err)
	}
	if _, err := os.Stat(tmpPath2); !os.IsNotExist(err) {
		t.Fatalf("case 2 spool file %s was not cleaned up", tmpPath2)
	}

	// Case 3: 恰好等于 maxBytes (512KB)
	exactMaxData := bytes.Repeat([]byte("C"), int(maxLimit))
	req3, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(exactMaxData))
	p3, err := ReadPayload(req3, maxLimit, threshold)
	if err != nil {
		t.Fatalf("case 3 exact maxLimit failed: %v", err)
	}
	if p3.Size != maxLimit {
		p3.Close()
		t.Fatalf("case 3 size mismatch: got %d, want %d", p3.Size, maxLimit)
	}
	tmpPath3 := p3.Path
	_ = p3.Close()
	if tmpPath3 != "" {
		if _, err := os.Stat(tmpPath3); !os.IsNotExist(err) {
			t.Fatalf("case 3 spool file %s not cleaned", tmpPath3)
		}
	}

	// Case 4: 恰好等于 maxBytes + 1 字节 (512KB + 1)
	oneOverMaxData := bytes.Repeat([]byte("D"), int(maxLimit)+1)
	req4, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(oneOverMaxData))
	p4, err := ReadPayload(req4, maxLimit, threshold)
	if err == nil {
		if p4 != nil {
			_ = p4.Close()
		}
		t.Fatal("case 4 expected error for maxLimit+1, got nil")
	}
	if !errors.Is(err, errRequestBodyTooLarge) {
		t.Fatalf("case 4 expected errRequestBodyTooLarge, got: %v", err)
	}
}

// TestRequestPayload_HasConversationIDStreamingScan 验证超大请求分块流式扫描 conversation_id：
// 1. 深度偏移（在 500KB 之后出现）精确命中；
// 2. 恰好横跨 32KB 分块窗口边界精确命中；
// 3. 无 conversation_id 返回 false；
// 4. 全过程零整包内存读回。
func TestRequestPayload_HasConversationIDStreamingScan(t *testing.T) {
	threshold := int64(64 * 1024)

	// 1. 深度偏移：在 400KB 位置插入 conversation_id
	prefix := bytes.Repeat([]byte("X"), 400*1024)
	deepBody := append(prefix, []byte(`"conversation_id":"deep-session-999"`)...)
	deepBody = append(deepBody, bytes.Repeat([]byte("Y"), 100*1024)...)

	req1, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(deepBody))
	p1, err := ReadPayload(req1, 16<<20, threshold)
	if err != nil {
		t.Fatalf("read deep payload failed: %v", err)
	}
	defer p1.Close()

	if !p1.IsSpool {
		t.Fatal("expected spool payload")
	}
	if !p1.HasConversationID() {
		t.Fatal("expected HasConversationID to detect deep conversation_id at 400KB offset")
	}

	// 2. 跨分块边界：恰好跨越 32KB (32768) 边界
	// 让 "conversation_id" 跨越 32760 ~ 32775 字节
	boundaryPrefix := bytes.Repeat([]byte("Z"), 32760)
	boundaryBody := append(boundaryPrefix, []byte(`"conversation_id":"boundary-conv"`)...)
	boundaryBody = append(boundaryBody, bytes.Repeat([]byte("W"), 40*1024)...)

	req2, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(boundaryBody))
	p2, err := ReadPayload(req2, 16<<20, threshold)
	if err != nil {
		t.Fatalf("read boundary payload failed: %v", err)
	}
	defer p2.Close()

	if !p2.HasConversationID() {
		t.Fatal("expected HasConversationID to detect boundary-spanning conversation_id")
	}

	// 3. 无 conversation_id 的纯净大请求
	cleanBody := bytes.Repeat([]byte("C"), 512*1024)
	req3, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(cleanBody))
	p3, err := ReadPayload(req3, 16<<20, threshold)
	if err != nil {
		t.Fatalf("read clean payload failed: %v", err)
	}
	defer p3.Close()

	if p3.HasConversationID() {
		t.Fatal("expected HasConversationID to return false for clean payload")
	}
}

// TestRequestPayload_MultipleReadersAndCleanup 验证多次 OpenReader 分配后的句柄追踪与统一清理
func TestRequestPayload_MultipleReadersAndCleanup(t *testing.T) {
	data := bytes.Repeat([]byte("R"), 300*1024)
	req, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(data))
	payload, err := ReadPayload(req, 16<<20, 64*1024)
	if err != nil {
		t.Fatalf("ReadPayload failed: %v", err)
	}
	tmpPath := payload.Path

	// 连续打开 3 个 Reader，模拟多轮重试打开流
	r1, err := payload.OpenReader()
	if err != nil {
		t.Fatalf("open r1 failed: %v", err)
	}
	r2, err := payload.OpenReader()
	if err != nil {
		t.Fatalf("open r2 failed: %v", err)
	}
	r3, err := payload.OpenReader()
	if err != nil {
		t.Fatalf("open r3 failed: %v", err)
	}

	// 只关闭 r1，故意留下 r2 和 r3 不手动关闭
	_ = r1.Close()

	// payload.Close() 必须负责关闭剩下的 r2、r3，并在 Windows 平台上成功物理删除临时文件
	if err := payload.Close(); err != nil {
		t.Fatalf("payload.Close() failed with remaining active readers: %v", err)
	}

	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatalf("spool file %s was not removed after Close()", tmpPath)
	}

	_ = r2
	_ = r3
}

// The admission spool is already integrity-checked and must not be copied to
// an additional request temporary file by the Chat handler.
func TestReadPayloadReusesPressureSpool(t *testing.T) {
	store, err := spool.Open(spool.Options{Dir: t.TempDir(), MaxBytes: 4 << 20})
	if err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte("fixture-payload"), 30000)
	job, err := store.Stage(context.Background(), bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer job.Complete("cancelled")
	body, err := job.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	req, _ := http.NewRequest(http.MethodPost, "/", body)
	req = req.WithContext(context.WithValue(req.Context(), spoolKey{}, job))
	h := NewHandler(Config{})
	payload, err := h.readPayload(req)
	if err != nil {
		t.Fatal(err)
	}
	defer payload.Close()
	if !payload.IsSpool || payload.Path != "" || payload.Size != int64(len(data)) {
		t.Fatalf("staged body copied or misidentified: %+v", payload)
	}
	r, err := payload.OpenReader()
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(r)
	r.Close()
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("staged body mismatch: %v", err)
	}
}
