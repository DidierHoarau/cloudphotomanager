# BUILD
FROM node:20-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

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

RUN apk add --no-cache nginx ffmpeg && \
    apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main vips-dev libheif-dev && \
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