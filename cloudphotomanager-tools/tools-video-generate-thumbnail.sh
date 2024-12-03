#!/bin/sh

FILE_IN=$1
FILE_OUT=$2

echo "Processing Thumbnail ${FILE_IN}: Started"
nice -20 ffmpeg \
  -i ${FILE_IN} \
  -vf "thumbnail" \
  -frames:v 1 \
  ${FILE_OUT}

echo "Processing Thumbnail ${FILE_OUT}: Completed"
