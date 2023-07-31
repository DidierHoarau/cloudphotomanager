# BUILD
FROM node:18-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY cloudphotomanager-server cloudphotomanager-server

RUN cd cloudphotomanager-server && \
    npm ci && \
    npm run build

COPY cloudphotomanager-web cloudphotomanager-web

RUN cd cloudphotomanager-web && \
    npm ci && \
    npm run build

# RUN
FROM node:18-alpine

COPY docker-config/entrypoint.sh /entrypoint.sh

RUN apk add --no-cache nginx && \
    npm install -g pm2
    
COPY docker-config/nginx.conf /etc/nginx/nginx.conf
COPY docker-config/ecosystem.config.js /opt/app/cloudphotomanager/ecosystem.config.js

COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output /opt/app/cloudphotomanager/web
COPY cloudphotomanager-server/config.json /opt/app/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql

WORKDIR /opt/app/cloudphotomanager

EXPOSE 80

ENTRYPOINT [ "/entrypoint.sh" ]