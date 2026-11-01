# The web frontend, as a release image.
#
# The previous version ran `npx vite --host` -- the development server, with
# hot module replacement, source maps and an unminified bundle. That is not a
# release: it is slower, far larger, and Vite's own documentation says not to
# expose it. This builds the static bundle and serves it with nginx.
#
# Built from the repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.org/api \
#     --build-arg VITE_SUPABASE_URL=... \
#     --build-arg VITE_SUPABASE_ANON_KEY=... \
#     -t ayira-web .
#
# Those values are baked in at build time, because Vite substitutes them into
# the bundle -- there is no runtime environment in a static file. The anon key
# is designed to be public and is protected by row-level security; the
# service-role key must never appear here.

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --workspace=apps/web --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build --workspace=apps/web

# ---------------------------------------------------------------------------
# 2. Serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
