//go:build no_logs

package logservice

import "github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"

func New(bool, Config) telemetry.Sink { return telemetry.Noop{} }

const Available = false
