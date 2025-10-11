# BUILD
FROM node:24 as builder

WORKDIR /opt/src

RUN apt-get update && apt-get install -y \
        build-essential \
        libvips-dev \
        libheif-dev \
        libfftw3-dev \
        gcc \
        g++ \
        make \
        python3 \
        wget \
    && rm -rf /var/lib/apt/lists/*

COPY cloudphotomanager-server cloudphotomanager-server

RUN cd cloudphotomanager-server && \
    npm ci && \
    npm run build

COPY cloudphotomanager-web cloudphotomanager-web

RUN cd cloudphotomanager-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:24

COPY docker-config/entrypoint.sh /entrypoint.sh

RUN apt-get update && apt-get install -y \
        build-essential \
        darktable \
        dcraw \
        ffmpeg \
        g++ \
        gcc \
        imagemagick \
        libavif-dev \
        libexpat1-dev \
        libfftw3-dev \
        libgif-dev \
        libheif-dev \
        libjpeg-dev \
        libpng-dev \
        libraw-bin \
        libraw-dev \
        libtiff-dev \
        libvips-dev \
        libwebp-dev \
        libxml2-dev \
        make \
        nginx \
        pkg-config \
        python3 \
        swig \
        wget \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pm2

COPY docker-config/default.conf /etc/nginx/http.d/default.conf
COPY docker-config/default.conf /etc/nginx/sites-enabled/default
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js

COPY cloudphotomanager-tools /opt/app/cloudphotomanager/tools
COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web
COPY config.json /etc/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql
COPY package.json /opt/app/cloudphotomanager/package.json

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]