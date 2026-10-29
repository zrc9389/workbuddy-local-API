package usage

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUnreadableFileNeverOverwritten(t *testing.T) {
	cases := []string{
		"{broken", "null", "{}", "{\"version\":4,\"buckets\":null}",
		"{\"version\":5,\"buckets\":[]}",
		"{\"version\":4,\"buckets\":[],\"buckets\":[]}",
		"{\"version\":4,\"buckets\":[{\"s\":\"opaque\"},{\"s\":\"opaque\"}]}",
		"{\"version\":4,\"buckets\":[],\"extra\":{\"a\":1,\"a\":2}}",
		"{\"Version\":4,\"buckets\":[]}",
	}
	for _, original := range cases {
		t.Run(original, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "usage.json")
			if err := os.WriteFile(path, []byte(original), 0600); err != nil {
				t.Fatal(err)
			}
			r := New(path)
			r.Add(time.Now(), "cn", "u", "m", Delta{}, true)
			if err := r.Save(); err == nil {
				t.Fatal("save should fail")
			}
			if _, err := r.DeleteAccount("u"); err == nil {
				t.Fatal("delete should fail")
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, []byte(original)) {
				t.Fatalf("file changed: %s", got)
			}
		})
	}
}

func TestUnknownFieldsSurviveSaveAndDelete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	scope := "h:" + time.Now().Format(hourLayout)
	original := `{"version":4,"buckets":[{"s":"` + scope + `","r":"cn","u":"keep","m":"m","q":1,"future":{"n":12345678901234567890}},{"s":"` + scope + `","r":"cn","u":"remove","m":"m","q":1}],"future_root":[1,{"x":true}]}`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	r := New(path)
	r.Add(time.Now(), "cn", "keep", "m", Delta{}, true)
	if err := r.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err := r.DeleteAccount("remove"); err != nil {
		t.Fatal(err)
	}
	r2 := New(path)
	if r2.loadErr != nil {
		t.Fatal(r2.loadErr)
	}
	if string(r2.fileExtra["future_root"]) != `[1,{"x":true}]` {
		t.Fatalf("root field lost: %s", r2.fileExtra["future_root"])
	}
	b := r2.buckets[scope+"|cn|keep|m|"]
	if b == nil || string(b.Extra["future"]) != `{"n":12345678901234567890}` || b.Req != 2 {
		t.Fatalf("bucket lost data: %+v", b)
	}
}

func TestExpiredBucketWithUnknownFieldsIsRetained(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	scope := "h:" + time.Now().Add(-48*time.Hour).Format(hourLayout)
	original := `{"version":4,"buckets":[{"s":"` + scope + `","q":1,"future":42}]}`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	r := New(path)
	r.Rollup(time.Now())
	if err := r.Save(); err != nil {
		t.Fatal(err)
	}
	var saved map[string]json.RawMessage
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(saved["buckets"], []byte(`"future":42`)) {
		t.Fatalf("unknown data lost: %s", raw)
	}
}
