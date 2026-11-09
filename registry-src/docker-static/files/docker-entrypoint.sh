#!/bin/sh
set -eu

test -f /usr/share/nginx/html/index.html || {
  echo "docker-static: /usr/share/nginx/html/index.html is missing" >&2
  exit 1
}
nginx -t
