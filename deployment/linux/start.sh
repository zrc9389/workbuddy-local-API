#!/bin/sh
# Convenience launcher only: no installation, downloads, chmod, or daemonization.
set -eu
umask 077

usage() {
    printf '%s\n' 'Usage: deployment/linux/start.sh [ABSOLUTE_CONFIG_FILE]' \
        'Default config: /etc/workbuddy-local/config.json' \
        'Run as the unprivileged workbuddy-local user; prepare directories manually.'
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 64; }
[ "$(uname -s)" = Linux ] || { printf '%s\n' 'Linux is required.' >&2; exit 69; }
case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) printf '%s\n' 'Only Linux amd64/arm64 are supported.' >&2; exit 69 ;;
esac
[ "$(id -u)" -ne 0 ] || { printf '%s\n' 'Refusing root runtime; use the dedicated workbuddy-local user.' >&2; exit 77; }

APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
config=${1:-/etc/workbuddy-local/config.json}
case "$config" in
    /*) ;;
    *) printf '%s\n' 'Use an absolute config path.' >&2; exit 64 ;;
esac
[ -f "$config" ] && [ -r "$config" ] && [ -w "$config" ] || {
    printf '%s\n' "Config must already exist and be readable/writable by this user: $config" >&2
    exit 78
}
config_dir=$(dirname -- "$config")
[ -w "$config_dir" ] && [ -x "$config_dir" ] || {
    printf '%s\n' "The containing config DIRECTORY must be writable for atomic settings saves: $config_dir" >&2
    exit 78
}
[ -f "$APP_ROOT/wb2api" ] && [ -x "$APP_ROOT/wb2api" ] || {
    printf '%s\n' "Missing Linux server executable: $APP_ROOT/wb2api" >&2
    exit 69
}
kernel="$APP_ROOT/third_party/meta/bin/linux-$arch/mihomo"
[ -f "$kernel" ] && [ -x "$kernel" ] || {
    printf '%s\n' "Missing executable pinned kernel: $kernel" >&2
    exit 69
}
[ -r "$APP_ROOT/third_party/meta/manifest.json" ] || {
    printf '%s\n' 'Missing kernel provenance manifest.' >&2
    exit 69
}
# Native metacore resolves its verified kernel relative to this working directory.
# Never inherit a wildcard/public listener override.
cd -- "$APP_ROOT"
WB2A_LISTEN=127.0.0.1:7863
export WB2A_LISTEN
# exec preserves the service main PID and delivers SIGTERM directly to Go.
exec "$APP_ROOT/wb2api" -config "$config"
