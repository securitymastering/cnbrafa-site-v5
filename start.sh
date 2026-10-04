#!/usr/bin/env sh
cd "$(dirname "$0")"
PORT=${PORT:-4173} node --no-warnings server.js
