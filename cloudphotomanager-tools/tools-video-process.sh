#!/bin/sh

FILE_IN=$1
FILE_OUT=$2
FILE_WIDTH=$3
if [ "${FILE_WIDTH}" == "" ]; then
  FILE_WIDTH=900
fi

echo "Processing $(ls -sh ${FILE_IN}): Started"
nice -20 ffmpeg \
  -nostats \
  -hide_banner \
  -loglevel error \
  -i ${FILE_IN} \
  -vf scale=${FILE_WIDTH}:-1 \
  -b:v 1M \
  -r 30 \
  -c:v libx264 \
  -b:a 128k \
  -threads 1 \
  ${FILE_OUT}
echo "Processing ${FILE_IN}: Completed"
echo "- Input: $(ls -sh ${FILE_IN})"
echo "- Output: $(ls -sh ${FILE_OUT}) (width: ${FILE_WIDTH})"
