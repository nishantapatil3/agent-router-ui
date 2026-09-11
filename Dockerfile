# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile first so dependency layers cache across code edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Only displayed on the Settings page ("what does the server proxy to?"). The
# real proxy targets are resolved at container start, not here — see below.
ARG AIGW_URL=http://localhost:1975
ARG AIGW_ADMIN_URL=http://localhost:1064
ENV AIGW_URL=$AIGW_URL AIGW_ADMIN_URL=$AIGW_ADMIN_URL

RUN npm run build

# ---- serve ----------------------------------------------------------------
FROM nginx:1.27-alpine

# The gateway sends no CORS headers, so the browser never calls it directly:
# nginx serves the bundle and reverse-proxies /api/gateway and /api/admin, the
# same split the Vite dev server does. Both upstreams are substituted into the
# config by the base image's envsubst entrypoint, so one image can point at any
# gateway.
ENV AIGW_URL=http://localhost:1975 \
    AIGW_ADMIN_URL=http://localhost:1064

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
