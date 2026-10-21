// Package logservice is the removable archive composition adapter.
package logservice

type Config struct {
	Dir           string
	Archive       bool
	RetentionDays int
	MaxBytes      int64
}
