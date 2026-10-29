package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSubscriptionIntervalConfigLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	for _, tc := range []struct {
		body    string
		want    int
		invalid bool
	}{
		{`{}`, 48, false}, {`{"panel":{"subscription_refresh_hours":12}}`, 12, false},
		{`{"panel":{"subscription_refresh_hours":8761}}`, 0, true},
	} {
		if err := os.WriteFile(path, []byte(tc.body), 0600); err != nil {
			t.Fatal(err)
		}
		cfg, err := Load(path)
		if tc.invalid {
			if err == nil {
				t.Fatal("invalid value accepted")
			}
			continue
		}
		if err != nil || cfg.Panel.SubscriptionRefreshHours != tc.want {
			t.Fatalf("got %v, %v", cfg, err)
		}
	}
}
