package metacore

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

const KernelVersion = "v1.19.32"
const WindowsAMD64SHA256 = "04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314"

type nativeCore struct {
	mu              sync.Mutex
	opts            Options
	address, secret string
	cmd             *exec.Cmd
	done            chan struct{}
	client          *http.Client
}

func newNative(o Options, address, secret string) *nativeCore {
	if o.Binary == "" {
		o.Binary, _ = KernelPath(runtime.GOOS, runtime.GOARCH)
	}
	if o.Binary != "" {
		o.Binary, _ = filepath.Abs(o.Binary)
	}
	tr := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: time.Second}).DialContext, DisableCompression: true, MaxIdleConns: 8, MaxConnsPerHost: 8, ResponseHeaderTimeout: 7 * time.Second}
	return &nativeCore{opts: o, address: address, secret: secret, client: &http.Client{Transport: tr, Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("controller redirect rejected") }}}
}
func (n *nativeCore) Available() bool {
	if _, ok := pinnedPlatform(runtime.GOOS, runtime.GOARCH); !ok {
		return false
	}
	s, e := os.Stat(n.opts.Binary)
	return e == nil && s.Mode().IsRegular() && s.Size() > 0 && s.Size() <= 128<<20 &&
		(runtime.GOOS != "linux" || s.Mode().Perm()&0111 != 0)
}
func (n *nativeCore) verified() bool {
	if !n.Available() {
		return false
	}
	f, e := os.Open(n.opts.Binary)
	if e != nil {
		return false
	}
	defer f.Close()
	h := sha256.New()
	_, e = io.Copy(h, io.LimitReader(f, 128<<20+1))
	pin, ok := pinnedPlatform(runtime.GOOS, runtime.GOARCH)
	return e == nil && ok && hex.EncodeToString(h.Sum(nil)) == pin.sha256
}
func (n *nativeCore) Alive() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.cmd == nil {
		return false
	}
	select {
	case <-n.done:
		return false
	default:
		return true
	}
}
func (n *nativeCore) Validate(ctx context.Context, b []byte) error {
	if !n.verified() {
		return ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	path := filepath.Join(n.opts.Dir, "candidate.json")
	if err := atomicWrite(path, b); err != nil {
		return errors.New("cannot stage core configuration")
	}
	cmd := exec.CommandContext(ctx, n.opts.Binary, "-t", "-d", n.opts.Dir, "-f", path)
	hideProcess(cmd)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return errors.New("native core configuration validation failed")
	}
	return nil
}
func (n *nativeCore) Start(ctx context.Context, b []byte) error {
	if n.Alive() {
		return nil
	}
	if !n.verified() {
		return ErrUnavailable
	}
	path := filepath.Join(n.opts.Dir, "runtime.json")
	if err := atomicWrite(path, b); err != nil {
		return err
	}
	cmd := exec.Command(n.opts.Binary, "-d", n.opts.Dir, "-f", path)
	hideProcess(cmd)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return ErrUnavailable
	}
	done := make(chan struct{})
	n.mu.Lock()
	n.cmd = cmd
	n.done = done
	n.mu.Unlock()
	go func() { _ = cmd.Wait(); close(done) }()
	ready, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		var v struct {
			Version string `json:"version"`
		}
		if n.Request(ready, "GET", "/version", nil, &v) == nil && v.Version != "" {
			return nil
		}
		select {
		case <-done:
			return ErrUnavailable
		case <-ready.Done():
			_ = n.Stop()
			return ErrUnavailable
		case <-ticker.C:
		}
	}
}
func (n *nativeCore) Apply(ctx context.Context, b []byte) error {
	return n.Request(ctx, "PUT", "/configs?force=true", map[string]string{"payload": string(b)}, nil)
}
func (n *nativeCore) Request(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return ErrInvalid
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://"+n.address+path, body)
	if err != nil {
		return ErrInvalid
	}
	req.Header.Set("Authorization", "Bearer "+n.secret)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("core controller request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusGatewayTimeout || resp.StatusCode == http.StatusRequestTimeout {
		return context.DeadlineExceeded
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("core controller rejected operation")
	}
	if out != nil {
		if err := decodeBounded(resp.Body, out); err != nil {
			return errors.New("invalid or oversized core response")
		}
	}
	return nil
}
func (n *nativeCore) Stop() error {
	n.mu.Lock()
	cmd, done := n.cmd, n.done
	n.cmd = nil
	n.mu.Unlock()
	if cmd == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	default:
	}
	if err := cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return errors.New("cannot stop managed kernel")
	}
	select {
	case <-done:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("managed kernel did not exit")
	}
}
func verifyLocalListener(ctx context.Context, b bindingRecord) error {
	// Relative-form GET has no URL scheme/host: native HTTP handler authenticates
	// first, then returns400 before its outbound client can dial anything.
	// Probe both auth states so an unrelated HTTP service is not accepted.
	for _, authenticated := range []bool{false, true} {
		d := net.Dialer{Timeout: time.Second}
		c, err := d.DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", b.Port))
		if err != nil {
			return errors.New("managed listener unavailable")
		}
		_ = c.SetDeadline(time.Now().Add(2 * time.Second))
		header := ""
		want := http.StatusProxyAuthRequired
		if authenticated {
			header = "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("workbuddy:"+b.Password)) + "\r\n"
			want = http.StatusBadRequest
		}
		_, err = fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: meta.invalid\r\n%sConnection: close\r\n\r\n", header)
		if err != nil {
			c.Close()
			return err
		}
		resp, err := http.ReadResponse(bufio.NewReader(c), &http.Request{Method: "GET"})
		if err != nil {
			c.Close()
			return errors.New("managed listener verification failed")
		}
		resp.Body.Close()
		c.Close()
		if resp.StatusCode != want {
			return errors.New("managed listener authentication mismatch")
		}
	}
	return nil
}
