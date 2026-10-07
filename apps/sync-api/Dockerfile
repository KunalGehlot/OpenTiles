# OpenTiles sync service. Build from the repository root:
#
#   docker build -f apps/sync-api/Dockerfile -t opentiles-sync .
#   docker run --env-file apps/sync-api/.env -p 8787:8787 -v opentiles-sync:/data opentiles-sync
#
# The image holds no secrets; configure it with environment variables (see .env.example).

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @opentiles/sync-api... \
 && pnpm --filter @opentiles/sync-api build \
 && pnpm --filter @opentiles/sync-api deploy --prod --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/sync.db \
    FS_ROOT=/data/blobs
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
