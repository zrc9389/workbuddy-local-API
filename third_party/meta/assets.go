package metaassets

import _ "embed"

// LatencyTrendJS is an actual type-stripped upstream metacubexd helper, not a
// reimplementation or the complete dashboard. See metacubexd/LICENSE.
//
//go:embed metacubexd/latency-trend.js
var LatencyTrendJS []byte
