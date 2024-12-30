#!/bin/sh

FILE_IN=$1
FILE_OUT=$2

set -e

echo "Converting Raw ${FILE_IN}"
magick ${FILE_IN} ${FILE_OUT}
# convert ${FILE_IN} ${FILE_OUT}
echo "Converting Raw ${FILE_OUT}: Completed"
