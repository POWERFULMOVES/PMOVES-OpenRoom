FROM node:20-alpine as builder

ARG ENV
ARG SENTRY_AUTH_TOKEN
ARG VITE_PMOVES_ROOMS_BASE_URL
ARG VITE_PMOVES_ROOM_DEFAULT
ARG VITE_PMOVES_ROOM_IFRAMES

ARG ENV CDN_SOURCE APP_PATH BIZ_PROJECT_NAME APP_ENVIRONMENT
ENV NODE_ENV=${ENV} \
  CDN_SOURCE=${CDN_SOURCE} \
  APP_PATH=${APP_PATH} \
  BIZ_PROJECT_NAME=${BIZ_PROJECT_NAME} \
  APP_ENVIRONMENT=${APP_ENVIRONMENT} \
  VITE_PMOVES_ROOMS_BASE_URL=${VITE_PMOVES_ROOMS_BASE_URL} \
  VITE_PMOVES_ROOM_DEFAULT=${VITE_PMOVES_ROOM_DEFAULT} \
  VITE_PMOVES_ROOM_IFRAMES=${VITE_PMOVES_ROOM_IFRAMES}

WORKDIR /app
COPY . .

# Optionally set a custom npm registry (e.g. China mirror: https://registry.npmmirror.com/)
# RUN npm config set registry https://registry.npmmirror.com/
RUN npm install -g pnpm@9
RUN HUSKY=0 NODE_ENV=development pnpm i --frozen-lockfile && pnpm store prune && rm -rf /root/.local/share/pnpm/store

WORKDIR ${APP_PATH}
RUN sh ./script/build.sh ${ENV}

FROM nginx:1.21.6-alpine
ARG APP_PATH
ENV APP_PATH=${APP_PATH}

RUN rm /etc/nginx/conf.d/default.conf
WORKDIR /

COPY --from=builder ${APP_PATH}/nginx/ /etc/nginx/conf.d/
COPY --from=builder ${APP_PATH}/dist/ /usr/share/nginx/html/
CMD ["nginx", "-g", "daemon off;"]

EXPOSE 3000