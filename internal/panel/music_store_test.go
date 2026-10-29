package panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

func TestMusicConcurrentUploadAndRestart(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	p := New(Config{ConfigPath: config})
	const count = 8
	var wg sync.WaitGroup
	codes := make(chan int, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := bytes.NewReader(bytes.Repeat([]byte{byte(i + 1)}, 20<<20))
			r := httptest.NewRequest("POST", "/panel/api/music/upload", body)
			r.Header.Set("X-Audio-Name", fmt.Sprintf("song-%d", i))
			r.Header.Set("Content-Type", "audio/mpeg")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, r)
			codes <- w.Code
		}(i)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatalf("upload failed %d", code)
		}
	}
	restarted := New(Config{ConfigPath: config})
	w := httptest.NewRecorder()
	restarted.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/music", nil))
	var state musicState
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if len(state.MusicList) != count+1 {
		t.Fatalf("lost songs: %d", len(state.MusicList))
	}
	id := state.MusicList[0].ID
	for _, action := range []string{"random", "select"} {
		body := fmt.Sprintf(`{"action":%q,"id":%q}`, action, id)
		w = httptest.NewRecorder()
		restarted.ServeHTTP(w, httptest.NewRequest("POST", "/panel/api/music/action", bytes.NewBufferString(body)))
		if w.Code != 200 {
			t.Fatalf("%s: %s", action, w.Body.String())
		}
		if action == "random" {
			again := New(Config{ConfigPath: config})
			check := httptest.NewRecorder()
			again.ServeHTTP(check, httptest.NewRequest("GET", "/panel/api/music", nil))
			var restored musicState
			if err := json.Unmarshal(check.Body.Bytes(), &restored); err != nil || !restored.RandomMusic || restored.ActiveMusicID != id {
				t.Fatalf("random state not restored: %s", check.Body.String())
			}
		}
	}
	w = httptest.NewRecorder()
	restarted.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/music/file/"+id, nil))
	if w.Code != 200 || w.Body.Len() != 20<<20 {
		t.Fatalf("file: %d %d", w.Code, w.Body.Len())
	}
	w = httptest.NewRecorder()
	restarted.ServeHTTP(w, httptest.NewRequest("POST", "/panel/api/music/action", bytes.NewBufferString(fmt.Sprintf(`{"action":"delete","id":%q}`, id))))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	final := New(Config{ConfigPath: config})
	w = httptest.NewRecorder()
	final.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/music", nil))
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if len(state.MusicList) != count || state.ActiveMusicID != "m-default" || state.RandomMusic {
		t.Fatalf("bad restored state: %+v", state)
	}
}

func TestMusicFileCorrectsMislabeledMP4(t *testing.T) {
	p := New(Config{ConfigPath: filepath.Join(t.TempDir(), "config.json")})
	data := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '}
	upload := httptest.NewRequest("POST", "/panel/api/music/upload", bytes.NewReader(data))
	upload.Header.Set("Content-Type", "audio/mpeg")
	upload.Header.Set("X-Audio-Name", "track")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, upload)
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	s, err := p.readMusic()
	if err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	p.ServeHTTP(w, httptest.NewRequest("GET", "/panel/api/music/file/"+s.MusicList[0].ID, nil))
	if w.Code != 200 || w.Header().Get("Content-Type") != "audio/mp4" || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatalf("incorrect file response: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
}
