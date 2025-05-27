FROM node:22

ENV LD_LIBRARY_PATH /usr/local/lib:$LD_LIBRARY_PATH

RUN apt-get update && \
    apt-get install -y \
        build-essential \
        python3-pip \
        meson \
        ninja-build \
        pkg-config \
        libjpeg-dev \
        libpng-dev \
        libtiff-dev \
        libgif-dev \
        libexpat1-dev \
        libxml2-dev \
        libwebp-dev \
        libavif-dev \
        libheif-dev \
        libfftw3-dev \
        libvips-dev \
        libraw-dev \
        dcraw \
        darktable \
        imagemagick \
        nginx \
        wget \
        ffmpeg \
        swig \
        gir1.2-glib-2.0 \
        gobject-introspection \
        gtk-doc-tools \
        libgirepository1.0-dev \
        git && \
    mkdir -p /usr/src/libvips && \
    cd /usr/src/libvips && \
    git clone https://github.com/libvips/libvips.git . && \
    meson setup build && \
    cd build && \
    meson compile && \
    meson install && \
    vips --version  && \
    npm install -g pm2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY docker-config/entrypoint.sh /entrypoint.sh
COPY docker-config/default.conf /etc/nginx/sites-enabled/default
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js
COPY config.json /etc/cloudphotomanager/config.json

COPY cloudphotomanager-server /opt/src/cloudphotomanager-server
COPY cloudphotomanager-web /opt/src/cloudphotomanager-web

COPY cloudphotomanager-tools /opt/app/cloudphotomanager/tools
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql

RUN vips --version  && \
    cd /opt/src/cloudphotomanager-server && \
    npm ci && \
    npm run build && \
    cp -R /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules && \
    cp -R /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist && \
    cd /opt/src/cloudphotomanager-web && \
    npm ci && \
    npm run generate && \
    cp -R /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]