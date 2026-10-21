#!/bin/sh
# Packaging template: copy this file to package-root/start.sh with mode 0755.
# For a source checkout, invoke deployment/linux/start.sh directly instead.
set -eu
app_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
launcher="$app_root/deployment/linux/start.sh"
[ -f "$launcher" ] && [ -x "$launcher" ] || {
    printf '%s\n' 'Package layout invalid: expected executable deployment/linux/start.sh beside package-root/start.sh.' >&2
    exit 69
}
exec "$launcher" "$@"
