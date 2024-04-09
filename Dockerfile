# BUILD
FROM node:20-alpine as builder

WORKDIR /opt/src

RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories && \
    apk add --no-cache --update \
        build-base \
        vips-dev=8.15.2-r0 \
        fftw-dev \
        gcc \
        g++ \
        make \
        python3 \
        wget \
        vips-dev=8.15.2-r0 \
        vips-heif=8.15.2-r0

COPY cloudphotomanager-server cloudphotomanager-server

RUN cd cloudphotomanager-server && \
    npm ci && \
    npm run build

COPY cloudphotomanager-web cloudphotomanager-web

RUN cd cloudphotomanager-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:20-alpine

COPY docker-config/entrypoint.sh /entrypoint.sh

RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories && \
    apk add --no-cache --update \
        build-base \
        vips-dev=8.15.2-r0 \
        fftw-dev \
        gcc \
        g++ \
        make \
        python3 \
        wget \
        vips-dev=8.15.2-r0 \
        vips-heif=8.15.2-r0 \
        nginx \
        ffmpeg && \
    npm install -g pm2
    
COPY docker-config/default.conf /etc/nginx/http.d/default.conf
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js

COPY cloudphotomanager-tools /opt/app/cloudphotomanager/tools
COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web
COPY cloudphotomanager-server/config.json /opt/app/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]