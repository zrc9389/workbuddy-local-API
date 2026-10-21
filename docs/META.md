> Linux主交付更新（2026-10-20）：当前代码已支持固定校验的Linux amd64/arm64内核，使用KernelPath自动选择。后文中的“Windows-only/other platforms not supplied”为最初工作包记录，不再代表当前平台范围；Linux安装、摘要、运行结果以META-LINUX.md和LINUX-VALIDATION.md为准。

# Meta sidecar integration · v0.2

## Scope / provenance

Official Mihomo **v1.19.32** (formerly Clash.Meta), separate optional process; no OS proxy, TUN or public listeners. Windows amd64 only is provisioned. No personal subscription/account or paid upstream was tested.

Actual limited metacubexd reuse: `third_party/meta/metacubexd/latencyTrend.ts` from official commit `8bbc8f58fef71148a94fb5c0ff808f79b057337d`. The JS removes types only; MIT license and original/adapted hashes are preserved. `Panel.MetaAsset` serves `/panel/vendor/latency-trend.js`. UI must import/use `computeLatencyTrend` and/or `svgPathFromPoints`. This is a **real upstream helper in our own compatible UI, NOT the full metacubexd dashboard/agent**.

## Parent contract

```go
manager, err := metacore.New(metacore.Options{Dir: privateMetaDir, Demo: demoMode})
// Optional Binary override; default third_party/meta/bin/windows-amd64/mihomo.exe.
// panel.Config.Meta = manager
release, err := manager.AcquireAccount(req.Context(), account.UID)
// Abort on error. Release on RoundTrip error; otherwise ONLY on Body.Close.
// Every account HTTP operation (chat/refresh/credit/task) needs this hook.
```

Unmanaged UID returns no-op release; release is idempotent. Acquire starts/restores persisted listeners and independent selections before traffic, including after a core exit. `Ensure(ctx)`, `EnsureStarted(ctx)` and `EnsureAccount(ctx,uid)` are convenience warmup APIs, NOT substitutes for leases. Never clear failed account proxy to direct. Parent wires existing session/Host/Origin/CSRF guards around handlers.

Idle stop defaults2min since last lease release: requires no leases, no node test, and a freshly empty connection snapshot. Operation lock prevents new leases racing stop/reload. Existing bindings no longer prevent idle stop. Stop requests/tasks and close bodies before `Close(ctx)`; it returns ErrBusy while sockets/leases remain instead of killing them. Caller must handle/retry errors. In-process stats survive idle stop but are not a durable ledger across application restarts.

## Isolation and atomic application

Each account gets stable UID-hashed route ID, stable loopback HTTP port, random proxy password and its own select group. Group options are provider leaf nodes, NEVER another selector/GLOBAL. Listener proxy routes to its own group before global/rule mode.

Existing binding changes use only `PUT /proxies/{account-group}`: other selections stay unchanged and existing streams keep their old route. The adapter uses `auth.SetProxyAndSave`, `Upstream.ForgetTransport(uid)`, egress cache invalidation. New connections get the selected route.

New listener/subscription changes require full generated configuration. A lease, live connection or test job returns409 rather than interrupting sockets (native provider initialization closes old provider connections). Sequence: stage JSON/valid YAML → pinned core `-t` → `PUT /configs?force=true` → restore independent selections → read provider/group state and verify authenticated local listener → atomic state persistence → account proxy callback. Controller204 alone is insufficient because listener errors can be only logged.

Failures roll back manager config/selection/state. Rollback failure stops sidecar fail-closed and reports503; no direct fallback. Atomic state writes are synced, then renamed. There is no OS two-file transaction with the account store: crash between manager/account persistence can leave an unused binding; existing account endpoint/password stays stable. Retained content-addressed provider versions are bounded, not bulk-deleted.

## Subscription / process safety

Downloader: HTTPS443 only, no userinfo/fragment, no environment proxy. Resolve/check ALL IPs, reject private/reserved/link-local/multicast, dial validated IP with hostname TLS validation. Revalidate each redirect (max3). Total20s, dial/TLS5s, headers8s/32KiB, body4MiB, no compression. No URL/token persistence, echo or logging. Re-submit same URL to refresh; no background fetch; changed token creates another provider ID.

Downloaded content becomes only a local **file provider**. Mihomo's native parser handles YAML `proxies`, URI and Base64 URI. No handmade parser or merging remote listeners/controller/rules. Explicit node-type allowlist; direct/reject/pass/dns excluded. Provider-prefixed names prevent cross-subscription collisions. Removing a bound node rejects/rolls back update. Top-level remote config keys cannot take over generated configuration.

Limits:16 providers;1000 total nodes;256 bindings;4MiB/subscription;64MiB retained provider storage;2MiB state;8MiB controller response;512 bytes/node name. Limits return errors without truncation. Credentials necessarily live in provider files, so dedicated directory is0700 POSIX or owner/SYSTEM inherited ACL Windows. Local admin/same-user access is not isolated. Controller binds127.0.0.1 with random bearer secret, never exposed to browser; no generic controller passthrough, socket/pipe interface or automatic updater.

## Protected frontend API (/panel/api)

- GET `/meta/status`: `{demo,available,running,state,version,subscriptions,nodes,bindings,error?}`.
- GET `/meta/nodes`: `{demo,nodes:[{id,name,type,provider,status,delay_ms?,tested_at?,history:[{delay,time}]}],bindings:[{uid,node,route_id,port}],total}`.
- POST `/meta/subscriptions` `{url}`: `{ok:true,provider,nodes}`.
- POST `/meta/tests` `{}` starts; `{cancel:true}` cancels. GET same route: `{demo,id,running,total,completed,failed,cancelled}`.
- POST `/meta/accounts/{uid}/bind` `{node}`: `{ok:true,binding:{uid,node,route_id,port},demo}`. No unbind endpoint yet.
- GET `/meta/stats`: `{demo,running,upload_total,download_total,upload_speed,download_speed,active_connections,estimated:true,accounts:[{uid,upload_total,download_total,upload_speed,download_speed,active_connections}],sampled_at?}`.

Errors:400 invalid,409 busy,408 cancelled,502 apply failure,503 unavailable/fail-closed. No raw URL, credentials or controller secret in payloads. Node names are untrusted display text: UI must escape them.

One async test job, max4 workers,6s request budget/native5000ms, max30min for1000 nodes, fixed HTTPS204 URL, no auto-retry/bandwidth download. Cancellation stops dispatch and cancels HTTP contexts; native cleanup is bounded by its timeout. Node history max10. This measures latency, not bandwidth capacity.

One `/connections` sampler every2s computes global total deltas and per-account deltas using inboundName. Short-lived connections/tails can be missed, so account totals are explicitly **estimated**. Speeds are bytes/sec of observed traffic, not line-capacity tests. No unbounded history or per-widget background loop.

## Demo

Options.Demo seeds3 simulated nodes, no processes/sockets/subscriptions. Tests/history, bindings and simulated counters change; all responses carry `demo:true`. Existing real state is not loaded and demo state is not persisted. Demo Panel bind does not change account proxy. Parent mock upstream owns chat/tasks. Never call simulated counters/delays real measurements.

## Installer / package

`powershell -File scripts/meta-install.ps1 [-Destination <new-staged-dir>]`. Default tree is `third_party/meta/bin/windows-amd64`. Does not overwrite existing EXE. Download bounded32MiB/120s, official release ZIP SHA256 validated, exactly one EXE <=128MiB extracted to explicit filename (no archive paths). EXE independently pinned and verified before validation/start. Updates are reviewed/staged/manual and require idle switchover; other platforms not supplied.

- ZIP SHA256: `974a4d7ad69aed27aa2e8f91d61113573c14dadb14562c63e58effabf59816f0`
- EXE SHA256: `04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314`
- `third_party/meta/manifest.json`: official release asset digest source, exact source URL, licensing/hashes. Preserve licenses/source references with distribution. Mihomo GPL-3.0; helper MIT; metadata only, not legal advice.

## Official references (checked2026-10-19)

- https://wiki.metacubex.one/en/config/inbound/listeners/
- https://wiki.metacubex.one/en/config/proxy-providers/content/
- https://wiki.metacubex.one/en/config/general/
- https://wiki.metacubex.one/en/api/
- https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.32
- https://github.com/MetaCubeX/mihomo/blob/v1.19.32/adapter/provider/provider.go
- https://github.com/MetaCubeX/mihomo/blob/v1.19.32/hub/route/provider.go
- https://github.com/MetaCubeX/mihomo/blob/v1.19.32/hub/route/configs.go
- https://github.com/MetaCubeX/mihomo/blob/v1.19.32/listener/inbound/base.go
- https://github.com/MetaCubeX/metacubexd/blob/8bbc8f58fef71148a94fb5c0ff808f79b057337d/packages/ui/utils/latencyTrend.ts

## Verification / remaining limits

`go test ./internal/metacore`; `go test ./internal/panel -run '^TestMeta'`; `go vet ./internal/metacore ./internal/panel ./third_party/meta`.

Opt-in smoke: `$env:META_REAL_TEST='1'; go test ./internal/metacore -run TestRealCore -v -count=1`. Fresh private temp state and loopback fixture proxies ONLY. Verifies native YAML/URI/Base64; controller401/listener407; independent A/B despite GLOBAL=REJECT; A-only switch preserving active stream; invalid provider rollback; top-level takeover ignored; persisted bindings demand restart. TEST-NET192.0.2.1 is carried in requests to fixture proxies, NEVER dialed; fixtures return local markers. No real public healthcheck/credentials/system proxy/TUN.

Not verified: actual subscription options/all protocols, real remote-node performance, long-duration/high-node-count load, non-Windows packaging, exact durable billing. Unknown external proxy URLs are untouched. Forced parent termination can leave a child kernel; orderly Close and error handling are required. Parent owns app-wide lease/UI integration validation.

### Final scoped verification (2026-10-19)

- `META_REAL_TEST=1 go test ./internal/metacore -run TestRealCore -v -count=1`: PASS; real test body2.08s. Includes **real idle process exit → AcquireAccount restart → stable B proxy returns fixture-B**, and Close refusal during a real active lease.
- `go test ./internal/metacore -count=1`: PASS.
- `go test ./internal/panel -run '^TestMeta' -count=1`: PASS.
- `go test ./internal/upstream -run 'Lease' -count=1`: PASS (parent-owned transport integration).
- `go vet ./internal/metacore ./internal/panel ./third_party/meta`: PASS.
- Vendored JS executed in Node: latency10/20/failure gives average15, jitter5, success67%, expected SVG path; PASS.
- Installer PowerShell parser validation: PASS. Official ZIP download/checksum/extraction executed successfully; installed EXE hash rechecked against manifest.
- Parent frontend now imports `/panel/vendor/latency-trend.js` and invokes both real upstream helper functions (source readback); whole-app browser acceptance belongs to parent.

Listener verification uses unauthenticated/authenticated **relative-form GET** expecting407/400. Native HTTP handling authenticates before rejecting the missing absolute URL, so verification does not dial a subscription node or any destination.
