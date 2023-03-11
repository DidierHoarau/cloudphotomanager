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
    npm run generate

# RUN
FROM node:18-alpine

COPY --from=builder /opt/src/cloudphotomanager-server/node_modules /opt/app/cloudphotomanager/node_modules
COPY --from=builder /opt/src/cloudphotomanager-server/dist /opt/app/cloudphotomanager/dist
COPY --from=builder /opt/src/cloudphotomanager-web/.output/public /opt/app/cloudphotomanager/web
COPY cloudphotomanager-server/config.json /opt/app/cloudphotomanager/config.json
COPY cloudphotomanager-server/sql /opt/app/cloudphotomanager/sql
COPY cloudphotomanager-server/processors-system /opt/app/cloudphotomanager/processors-system
COPY cloudphotomanager-server/processors-user /opt/app/cloudphotomanager/processors-user

WORKDIR /opt/app/cloudphotomanager

CMD [ "dist/app.js" ]