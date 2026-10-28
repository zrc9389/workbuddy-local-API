#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -f "config.json" ]; then
    if [ -f "config.example.json" ]; then
        echo "[INFO] Initializing config.json from config.example.json..."
        cp config.example.json config.json
    fi
fi

chmod +x wb2api
echo "[INFO] Starting WorkBuddy Local on 127.0.0.1:7863..."
echo "[INFO] Panel URL: http://127.0.0.1:7863/panel/"
./wb2api -config config.json
