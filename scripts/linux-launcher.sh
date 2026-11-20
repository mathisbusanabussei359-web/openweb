#!/bin/sh
set -eu

directory=$(dirname -- "$(readlink -f -- "$0")")
helper=${CHROME_DEVEL_SANDBOX:-"$directory/chrome-sandbox"}

if [ "$(stat -c '%u:%a' -- "$helper" 2>/dev/null)" = '0:4755' ]; then
  exec "$directory/openweb-bin" "$@"
fi

# Chromium still requires its namespace sandbox when the setuid helper is unavailable.
exec "$directory/openweb-bin" --disable-setuid-sandbox "$@"
