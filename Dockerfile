# syntax=docker/dockerfile:1.7
# Optional Linux-only build. Normal build traffic: base images, apk, go.mod/go.sum.
# No kernel download: pinned ELF and provenance must already be in build context.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
RUN apk add --no-cache python3
COPY go.mod go.sum ./
RUN go mod download
# Explicit source/embedded assets only: never copy runtime/auth/demo/release data.
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY third_party/meta/assets.go third_party/meta/manifest.json third_party/meta/MIHOMO-LICENSE ./third_party/meta/
COPY third_party/meta/metacubexd/ ./third_party/meta/metacubexd/
COPY third_party/meta/bin/linux-${TARGETARCH}/mihomo ./third_party/meta/bin/linux-${TARGETARCH}/mihomo
COPY deployment/linux/verify-mihomo.py ./deployment/linux/verify-mihomo.py
RUN case "${TARGETOS}/${TARGETARCH}" in linux/amd64|linux/arm64) ;; *) echo 'Linux amd64/arm64 only' >&2; exit 1 ;; esac \
 && python3 deployment/linux/verify-mihomo.py --root /src --arch "${TARGETARCH}" \
 && mkdir -p /out \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/wb2api ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/signin_bin ./cmd/signin \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/login ./cmd/login \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/credit ./cmd/credit

FROM alpine:3.23 AS runtime
ARG TARGETARCH
RUN apk add --no-cache ca-certificates tzdata curl \
 && addgroup -S -g 10001 workbuddy-local \
 && adduser -S -D -H -u 10001 -G workbuddy-local -s /sbin/nologin workbuddy-local \
 && install -d -m 0700 -o 10001 -g 10001 /etc/workbuddy-local /var/lib/workbuddy-local /var/lib/workbuddy-local/auths
WORKDIR /opt/workbuddy-local
COPY --from=build --chmod=0555 /out/wb2api /out/signin_bin /out/login /out/credit ./
COPY --from=build --chmod=0555 /src/third_party/meta/bin/linux-${TARGETARCH}/mihomo ./third_party/meta/bin/linux-${TARGETARCH}/mihomo
COPY --from=build --chmod=0444 /src/third_party/meta/manifest.json /src/third_party/meta/MIHOMO-LICENSE ./third_party/meta/
COPY --chmod=0555 deployment/linux/start.sh deployment/linux/healthcheck.sh ./deployment/linux/
COPY --chmod=0444 deployment/linux/config.json.example ./deployment/linux/config.json.example
COPY --chmod=0444 LICENSE ./LICENSE
COPY --from=build --chmod=0444 /src/third_party/meta/metacubexd/LICENSE ./third_party/meta/metacubexd/LICENSE
ENV TZ=UTC \
    GOMEMLIMIT=384MiB \
    WB2A_LISTEN=127.0.0.1:7863 \
    WB2A_AUTH_DIR=/var/lib/workbuddy-local/auths \
    WB2A_STATE_FILE=/var/lib/workbuddy-local/state.json
USER 10001:10001
STOPSIGNAL SIGTERM
# Check liveness without logging in; account-pool readiness is separate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/opt/workbuddy-local/deployment/linux/healthcheck.sh"]
ENTRYPOINT ["/opt/workbuddy-local/deployment/linux/start.sh"]
CMD ["/etc/workbuddy-local/config.json"]
