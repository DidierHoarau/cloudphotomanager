#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true

cd ${REPO_DIR}

./docs/dev/docker-build-images.sh

docker rm -f cloudphotomanager || true

SERVICE_VERSION=$(cat ${REPO_DIR}/package.json | jq -r '.version')

docker run -p 80:8080 -d --name cloudphotomanager didierhoarau/cloudphotomanager:${SERVICE_VERSION}

docker logs -f cloudphotomanager
