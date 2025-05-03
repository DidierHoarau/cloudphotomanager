# BUILD
FROM node:22 as builder

WORKDIR /opt/src

RUN apt-get update && apt-get install -y \
        build-essential \
        libvips-dev \
        libvips-heif \
        libfftw3-dev \
        gcc \
        g++ \
        make \
        python3 \
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
        libfftw3-dev \
        g++ \
        gcc \
        imagemagick \
        libraw-dev \
        make \
        nginx \
        python3 \
        libvips-dev \
        libvips-heif \
        wget \
        ffmpeg && \
    npm install -g pm2

COPY docker-config/default.conf /etc/nginx/http.d/default.conf
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js

COPY docker-config/tools /opt/app/cloudphotomanager/tools
COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web
COPY config.json /etc/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]