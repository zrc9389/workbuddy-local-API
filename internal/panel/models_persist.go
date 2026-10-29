package panel

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
)

const maxModelsCacheBytes = 8 << 20

type persistedModels struct {
	Version int                              `json:"version"`
	Domains map[string]persistedModelsDomain `json:"domains"`
}
type persistedModelsDomain struct {
	Infos    []upstream.ModelInfo `json:"models,omitempty"`
	Fetched  time.Time            `json:"fetched"`
	LastFail time.Time            `json:"last_fail,omitempty"`
}

// 只持久化目录和时间，不持久化上游错误文本、账号或令牌。
func (p *Panel) persistModelsCacheLocked() {
	path := p.cfg.ModelsCachePath
	if path == "" {
		return
	}
	doc := persistedModels{Version: 1, Domains: make(map[string]persistedModelsDomain)}
	for _, realm := range []string{"cn", "global"} {
		if s := p.modelsCache[realm]; s != nil {
			doc.Domains[realm] = persistedModelsDomain{Infos: s.infos, Fetched: s.fetched, LastFail: s.lastFail}
		}
	}
	data, err := json.Marshal(doc)
	if err == nil && len(data) > maxModelsCacheBytes {
		err = errors.New("model cache exceeds size limit")
	}
	if err == nil {
		err = writeModelsCache(path, data)
	}
	if err != nil {
		log.Printf("panel: model cache persistence failed: %v", err)
	}
}

func writeModelsCache(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".panel-models-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func (p *Panel) loadModelsCache() {
	if p.cfg.ModelsCachePath == "" {
		return
	}
	f, err := os.Open(p.cfg.ModelsCachePath)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		log.Printf("panel: model cache unavailable: %v", err)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxModelsCacheBytes+1))
	if err != nil || len(data) > maxModelsCacheBytes {
		log.Printf("panel: model cache unreadable or too large")
		return
	}
	var doc persistedModels
	if json.Unmarshal(data, &doc) != nil || doc.Version != 1 {
		log.Printf("panel: invalid model cache")
		return
	}
	now := time.Now()
	for _, realm := range []string{"cn", "global"} {
		d, ok := doc.Domains[realm]
		if !ok {
			continue
		}
		if d.Fetched.After(now) || d.Fetched.IsZero() {
			d.Infos = nil
			d.Fetched = time.Time{}
		}
		if d.LastFail.After(now) {
			d.LastFail = time.Time{}
		}
		p.modelsCache[realm] = &panelModelsSnapshot{infos: d.Infos, fetched: d.Fetched, lastFail: d.LastFail, lastErr: "上游模型查询失败（缓存）"}
	}
}
