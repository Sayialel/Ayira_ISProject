# The API gateway, as a release image.
#
# The previous version ran `npx tsx src/index.ts` -- a development runner that
# compiles TypeScript on the fly on every start. That is the wrong thing to
# deploy: it ships the compiler and the source, starts slower, and means a type
# error reaches runtime rather than the build. This builds once and runs the
# emitted JavaScript.
#
# Built from the repository root, because the gateway resolves its workspace
# dependencies from the root lockfile:
#   docker build -f apps/api/Dockerfile -t ayira-api .

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /repo

# The lockfile first, so a dependency change is the only thing that busts the
# install layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# ci, not install: it installs exactly what the lockfile pins, so an image
# cannot be built against a version nobody committed.
RUN npm ci --workspace=apps/api --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

# tsconfig.json excludes *.test.ts, so tests are typechecked in CI but never
# compiled into the release.
RUN npm run build --workspace=apps/api

# ---------------------------------------------------------------------------
# 2. Run
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Production dependencies only: no TypeScript, no tsx, no test runner.
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root \
 && npm cache clean --force

COPY --from=build /repo/apps/api/dist ./apps/api/dist

# node:20-slim ships a `node` user already.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
