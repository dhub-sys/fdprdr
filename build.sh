#!/usr/bin/env bash
# Builds the installable Joomla package: dist/plg_system_pdfflipbook-<version>.zip
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' plg_system_pdfflipbook/pdfflipbook.xml)
mkdir -p dist
OUT="dist/plg_system_pdfflipbook-${VERSION}.zip"
rm -f "$OUT"
(cd plg_system_pdfflipbook && zip -qr -X "../$OUT" . -x '.*')
echo "$OUT"
