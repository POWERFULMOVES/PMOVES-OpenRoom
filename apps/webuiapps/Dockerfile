FROM node:20-alpine as builder

ARG ENV
ARG SENTRY_AUTH_TOKEN

ARG ENV CDN_SOURCE APP_PATH BIZ_PROJECT_NAME APP_ENVIRONMENT
ENV NODE_ENV=${ENV} \
  CDN_SOURCE=${CDN_SOURCE} \
  APP_PATH=${APP_PATH} \
  BIZ_PROJECT_NAME=${BIZ_PROJECT_NAME} \
  APP_ENVIRONMENT=${APP_ENVIRONMENT}

# openroom-adapter Level B: JSON map { "<room_id>": "<served-url>" } that the
# StubApp reads at BUILD time (Vite inlines VITE_* variables into the bundle).
# Without it every PMOVES room renders as manifest stubs. Pass from compose:
#   build.args.VITE_PMOVES_ROOM_IFRAMES: ${OPENROOM_ROOM_IFRAMES:-}
ARG VITE_PMOVES_ROOM_IFRAMES=""
ENV VITE_PMOVES_ROOM_IFRAMES=${VITE_PMOVES_ROOM_IFRAMES}

WORKDIR /app
COPY . .

# Optionally set a custom npm registry (e.g. China mirror: https://registry.npmmirror.com/)
# RUN npm config set registry https://registry.npmmirror.com/
RUN npm install -g pnpm@9
# --prod=false: NODE_ENV=${ENV} (=production) above makes pnpm skip ALL
# devDependencies workspace-wide — vite is a devDep, so the frozen install
# completes green while leaving the workspace without a build toolchain;
# build.sh then fails with "Local package.json exists, but node_modules
# missing". Production trimming happens inside `vite build` itself.
RUN pnpm i --frozen-lockfile --prod=false && pnpm store prune && rm -rf /root/.local/share/pnpm/store || true

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