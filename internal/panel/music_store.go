package panel

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type musicItem struct {
	ID        string `json:"id"`
	Date      string `json:"date"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	IsDefault bool   `json:"isDefault"`
	MIME      string `json:"mime,omitempty"`
}
type musicState struct {
	MusicList     []musicItem `json:"musicList"`
	ActiveMusicID string      `json:"activeMusicId"`
	RandomMusic   bool        `json:"randomMusic"`
}

func (p *Panel) musicDir() string {
	if p.cfg.ConfigPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(p.cfg.ConfigPath), "panel-audio")
}
func (p *Panel) readMusic() (musicState, error) {
	s := musicState{MusicList: []musicItem{{ID: "m-default", Date: "2026-10-24 12:00", Name: "Canopy Ambient // 默认雨林氛围音", IsDefault: true}}, ActiveMusicID: "m-default"}
	b, e := os.ReadFile(filepath.Join(p.musicDir(), "state.json"))
	if os.IsNotExist(e) {
		if legacy, ok := p.customData["customization"].(map[string]any); ok {
			if raw, err := json.Marshal(legacy); err == nil {
				var restored musicState
				if json.Unmarshal(raw, &restored) == nil && len(restored.MusicList) > 0 {
					return restored, nil
				}
			}
		}
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(b, &s)
	return s, e
}
func (p *Panel) writeMusic(s musicState) error {
	dir := p.musicDir()
	if dir == "" {
		return fmt.Errorf("storage unavailable")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".state-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	if e := f.Close(); err == nil {
		err = e
	}
	if err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, "state.json"))
}
func (p *Panel) musicGet(w http.ResponseWriter, r *http.Request) {
	p.customMu.RLock()
	defer p.customMu.RUnlock()
	if p.musicDir() == "" {
		writeErr(w, 503, "audio storage unavailable")
		return
	}
	s, e := p.readMusic()
	if e != nil {
		writeErr(w, 500, "audio state unavailable")
		return
	}
	writeJSON(w, 200, s)
}
func (p *Panel) musicUpload(w http.ResponseWriter, r *http.Request) {
	name, decodeErr := url.QueryUnescape(r.Header.Get("X-Audio-Name"))
	name = strings.TrimSpace(name)
	mime := r.Header.Get("Content-Type")
	if decodeErr != nil || name == "" || len(name) > 512 || !strings.HasPrefix(mime, "audio/") {
		writeErr(w, 400, "invalid audio metadata")
		return
	}
	dir := p.musicDir()
	if dir == "" {
		writeErr(w, 503, "audio storage unavailable")
		return
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		writeErr(w, 500, "audio storage unavailable")
		return
	}
	f, e := os.CreateTemp(dir, ".upload-*")
	if e != nil {
		writeErr(w, 500, "audio upload failed")
		return
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	n, e := io.Copy(f, r.Body)
	if e == nil && n == 0 {
		e = fmt.Errorf("empty")
	}
	if e == nil {
		e = f.Sync()
	}
	if x := f.Close(); e == nil {
		e = x
	}
	if e != nil {
		writeErr(w, 400, "audio upload failed")
		return
	}
	var key [16]byte
	if _, e = rand.Read(key[:]); e != nil {
		writeErr(w, 500, "audio upload failed")
		return
	}
	id := hex.EncodeToString(key[:])
	path := filepath.Join(dir, id)
	p.customMu.Lock()
	defer p.customMu.Unlock()
	s, e := p.readMusic()
	if e != nil {
		writeErr(w, 500, "audio state unavailable")
		return
	}
	if e = os.Rename(tmp, path); e != nil {
		writeErr(w, 500, "audio upload failed")
		return
	}
	item := musicItem{ID: id, Date: time.Now().Format("2006-01-02 15:04"), Name: name, URL: "/panel/api/music/file/" + id, MIME: mime}
	s.MusicList = append([]musicItem{item}, s.MusicList...)
	if e = p.writeMusic(s); e != nil {
		os.Remove(path)
		writeErr(w, 500, "audio state save failed")
		return
	}
	writeJSON(w, 200, s)
}
func (p *Panel) musicAction(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Action string `json:"action"`
		ID     string `json:"id"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&v) != nil {
		writeErr(w, 400, "invalid action")
		return
	}
	p.customMu.Lock()
	defer p.customMu.Unlock()
	if p.musicDir() == "" {
		writeErr(w, 503, "audio storage unavailable")
		return
	}
	s, e := p.readMusic()
	if e != nil {
		writeErr(w, 500, "audio state unavailable")
		return
	}
	idx := -1
	for i, m := range s.MusicList {
		if m.ID == v.ID {
			idx = i
			break
		}
	}
	switch v.Action {
	case "select", "random":
		if idx < 0 {
			writeErr(w, 404, "audio not found")
			return
		}
		s.ActiveMusicID = v.ID
		s.RandomMusic = v.Action == "random"
	case "delete":
		if idx < 0 || s.MusicList[idx].IsDefault {
			writeErr(w, 400, "audio cannot be deleted")
			return
		}
		s.MusicList = append(s.MusicList[:idx], s.MusicList[idx+1:]...)
		if s.ActiveMusicID == v.ID {
			s.ActiveMusicID = "m-default"
			s.RandomMusic = false
		}
	default:
		writeErr(w, 400, "invalid action")
		return
	}
	if e = p.writeMusic(s); e != nil {
		writeErr(w, 500, "audio state save failed")
		return
	}
	if v.Action == "delete" && len(v.ID) == 32 {
		if _, e = hex.DecodeString(v.ID); e == nil {
			_ = os.Remove(filepath.Join(p.musicDir(), v.ID))
		}
	}
	writeJSON(w, 200, s)
}
func (p *Panel) musicFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if len(id) != 32 {
		http.NotFound(w, r)
		return
	}
	if _, e := hex.DecodeString(id); e != nil {
		http.NotFound(w, r)
		return
	}
	p.customMu.RLock()
	defer p.customMu.RUnlock()
	s, e := p.readMusic()
	if e != nil {
		http.NotFound(w, r)
		return
	}
	for _, m := range s.MusicList {
		if m.ID == id {
			f, e := os.Open(filepath.Join(p.musicDir(), id))
			if e != nil {
				http.NotFound(w, r)
				return
			}
			defer f.Close()
			st, e := f.Stat()
			if e != nil {
				http.NotFound(w, r)
				return
			}
			contentType := m.MIME
			// Older imports could be labelled MP3 even when their container is MP4.
			// Inspect only the header and leave the original file and metadata intact.
			var header [12]byte
			if n, _ := f.ReadAt(header[:], 0); n >= 12 && string(header[4:8]) == "ftyp" {
				contentType = "audio/mp4"
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.ServeContent(w, r, m.Name, st.ModTime(), f)
			return
		}
	}
	http.NotFound(w, r)
}
