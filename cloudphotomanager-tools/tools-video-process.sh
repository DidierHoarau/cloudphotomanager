#!/bin/sh

FILE_IN=$1
FILE_OUT=$2
echo "Processing ${FILE_IN}: Started (to ${FILE_OUT})"
ffmpeg -nostats -hide_banner -loglevel error -i ${FILE_IN} -vf scale=900:-1 -b:v 1M -r 30 -c:v libvpx -crf 20 -c:a libvorbis -b:a 128k ${FILE_OUT}
echo "Processing ${FILE_IN}: Completed"
ls -sh ${FILE_OUT}
