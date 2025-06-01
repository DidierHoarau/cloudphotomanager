#!/bin/sh

FILE_IN=$1
FILE_OUT=$2

# Get file extension in lowercase
EXT=$(echo "${FILE_IN##*.}" | tr '[:upper:]' '[:lower:]')

# List of RAW extensions (add more as needed)
RAW_EXTENSIONS="cr2 nef arw dng raf rw2 orf pef srw"

# Function to check if extension is in RAW_EXTENSIONS
is_raw() {
  for ext in $RAW_EXTENSIONS; do
    if [ "$EXT" = "$ext" ]; then
      return 0
    fi
  done
  return 1
}

set -e

if is_raw; then
  echo "Converting RAW/DNG ${FILE_IN} to JPG using darktable-cli"
  darktable-cli "${FILE_IN}" "${FILE_OUT}" --core
else
  COVERT_CMD="magick"
  if command -v magick >/dev/null 2>&1; then
    COVERT_CMD="magick"
  else
    COVERT_CMD="convert"
  fi
  echo "Converting ${FILE_IN} to ${FILE_OUT} using ${COVERT_CMD}"
  ${COVERT_CMD} "${FILE_IN}" "${FILE_OUT}"
fi

echo "Converting Raw ${FILE_OUT}: Completed"
