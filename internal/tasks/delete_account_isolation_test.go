package tasks

import "testing"

func TestDeleteAccountClearsOnlyItsQueueItems(t *testing.T) {
	s := New(Config{})
	q := s.queue()
	q.mu.Lock()
	q.items = []QueueItem{{UID: "a", Nickname: "secret-a", Status: "done"}, {UID: "b", Nickname: "B", Status: "pending"}}
	q.mu.Unlock()
	if err := s.DeleteAccount("a"); err != nil {
		t.Fatal(err)
	}
	items := s.QueueStatus().Items
	if items[0] != (QueueItem{}) || items[1].UID != "b" || items[1].Status != "pending" {
		t.Fatalf("items=%+v", items)
	}
}
