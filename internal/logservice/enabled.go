//go:build !no_logs

package logservice

import (
	"github.com/linguo2625469/workbuddy2api-panel/internal/reqlog"
	"github.com/linguo2625469/workbuddy2api-panel/internal/telemetry"
)

func New(enabled bool, c Config) telemetry.Sink {
	if !enabled {
		return telemetry.Noop{}
	}
	// 生产日志只保留模型调用错误：成功请求仍计入内存汇总指标，但不写错误列表或归档。
	// 24 小时、条数与容量上限由 reqlog 的错误模式硬化，旧配置只控制是否归档。
	_ = c.RetentionDays
	_ = c.MaxBytes
	return reqlog.New(reqlog.Config{
		Dir:           c.Dir,
		Enabled:       c.Archive,
		RetentionDays: 1,
		ErrorsOnly:    true,
	})
}

const Available = true
