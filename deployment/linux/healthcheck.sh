#!/bin/sh
# Liveness, not account-pool readiness. No management session is created.
set -eu
status=$(curl --noproxy '*' --silent --show-error --max-time 3 \
    --output /dev/null --write-out '%{http_code}' \
    http://127.0.0.1:7863/auth/session) || exit 1
[ "$status" = 200 ]
