# The API gateway, as a release image.
#
# Built from apps/api alone, because the gateway has no workspace imports --
# lib/constants.ts duplicates the shared category list for exactly this
# reason. So the build context is this directory and nothing above it.
#
# Why Docker rather than Render's Node runtime: the hosted build kept
# compiling with a TypeScript that was not the pinned one, failing on
# "Option 'moduleResolution=node10' has been removed" while 5.9.3 locally
# accepts it, and with @types/node unresolvable. Rather than keep guessing at
# someone else's toolchain, this pins the base image, the install and the
# compiler invocation, so the build behaves the same here as on a laptop.
#
#   docker build -f apps/api/Dockerfile -t ayira-api apps/api

# Node 22, not 20. @supabase/realtime-js requires a native WebSocket, which
# Node added in 22; on 20 the client throws at import time -- "Node.js 20
# detected without native WebSocket support" -- the moment lib/supabase.js
# loads. It was invisible locally because this machine runs Node 24.
#
# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

# Manifest first, so a source edit does not bust the install layer.
COPY package.json ./
# install, not ci: there is no lockfile in this directory, and the root one is
# generated on Windows, where npm records only the platform-relevant optional
# dependencies -- so it omits the Linux esbuild binaries and `npm ci` refuses.
# Every version that matters is pinned exactly in package.json instead.
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# The local compiler by explicit path, never a tsc that happens to be on PATH.
# That ambiguity is what broke the hosted build.
RUN ./node_modules/.bin/tsc --version && ./node_modules/.bin/tsc

# ---------------------------------------------------------------------------
# 2. Run
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
# Production dependencies only: no TypeScript, no tsx, no test runner.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# node:22-slim ships a `node` user already.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
