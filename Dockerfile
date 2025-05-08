# BUILD
FROM node:22 as builder

WORKDIR /opt/src

RUN apt-get update && apt-get install -y \
        build-essential \
        g++ \
        gcc \
        make \
        python3 \
        libvips-dev \
        libheif-dev \
        libfftw3-dev \
        libraw-dev \
        wget \
        git

COPY cloudphotomanager-server cloudphotomanager-server

RUN cd cloudphotomanager-server && \
    npm ci && \
    npm run build

COPY cloudphotomanager-web cloudphotomanager-web

RUN cd cloudphotomanager-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:22

COPY docker-config/entrypoint.sh /entrypoint.sh

RUN apt-get update && apt-get install -y \
        build-essential \
        g++ \
        gcc \
        make \
        python3 \
        libvips-dev \
        libheif-dev \
        libfftw3-dev \
        libraw-dev \
        imagemagick \
        nginx \
        wget \
        ffmpeg && \
    npm install -g pm2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY docker-config/default.conf /etc/nginx/sites-enabled/default
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js

COPY cloudphotomanager-tools /opt/app/cloudphotomanager/tools
COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web
COPY config.json /etc/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]