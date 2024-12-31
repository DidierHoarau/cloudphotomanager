#!/bin/sh

FILE_IN=$1
FILE_OUT=$2

COVERT_CMD="magick"

if command -v magick >/dev/null 2>&1; then
  COVERT_CMD="magick"
else
  COVERT_CMD="convert"
fi

set -e

echo "Converting Raw ${FILE_IN}"
${COVERT_CMD} ${FILE_IN} ${FILE_OUT}
echo "Converting Raw ${FILE_OUT}: Completed"
