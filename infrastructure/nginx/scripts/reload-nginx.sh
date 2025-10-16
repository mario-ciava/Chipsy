#!/bin/sh
set -e
PID_FILE="/var/run/nginx.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        kill -HUP "$PID" 2>/dev/null || true
    fi
fi
