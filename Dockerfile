# syntax=docker/dockerfile:1.7
# Slana: one container = game server + static web client on the same origin.
#   docker build -t slana .
#   docker run -p 8787:8787 -v slana-data:/data --env-file apps/server/.env slana

FROM node:22-bookworm-slim AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# install dependencies first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
COPY packages/art/package.json packages/art/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

# Optional build-time settings for the browser bundle
ARG VITE_SERVER_URL=""
ARG VITE_RPC_URL=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL VITE_RPC_URL=$VITE_RPC_URL

RUN pnpm -F @elymum/web build \
 && pnpm -F @elymum/server build \
 && pnpm --filter @elymum/server deploy --legacy --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
