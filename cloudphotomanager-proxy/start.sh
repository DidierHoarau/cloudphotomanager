#!/bin/bash
set -e

SERVICE_DIR="$( cd "$( dirname "$0" )" && pwd )"
cd ${SERVICE_DIR}

# Pinned Traefik release + checksum: the proxy downloads the binary on first
# start, so the archive must be verified before extraction.
TRAEFIK_VERSION="v3.7.17"
TRAEFIK_ARCHIVE="traefik_${TRAEFIK_VERSION}_linux_amd64.tar.gz"
TRAEFIK_SHA256="a564abd5fc8ee97d838270f188bb94cb3172cc113f4b51aa5e7dd6117eedb393"
TRAEFIK_URL="https://github.com/traefik/traefik/releases/download/${TRAEFIK_VERSION}/${TRAEFIK_ARCHIVE}"

if [ ! -d bin ]; then
    mkdir -p bin
    cd bin
    wget -O "${TRAEFIK_ARCHIVE}" "${TRAEFIK_URL}"
    echo "${TRAEFIK_SHA256}  ${TRAEFIK_ARCHIVE}" | sha256sum -c -
    tar -xzf "${TRAEFIK_ARCHIVE}"
    rm "${TRAEFIK_ARCHIVE}"
    cd ..
fi

cd ${SERVICE_DIR}
./bin/traefik \
    --entryPoints.web.address=:9007 \
    --providers.file.watch=true \
    --providers.file.filename=traefik-rules.yml \
    --entrypoints.dashboard.address=:9091 \
    --api=true \
    --api.dashboard=true
