FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/android/package.json ./apps/android/package.json
COPY tsconfig.json ./
COPY scripts ./scripts
RUN npm ci && npm run build && node scripts/build-worker.mjs

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 SUBTITLE_DATA_DIR=/data HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-noto-cjk fonts-noto-core tini && rm -rf /var/lib/apt/lists/* && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/dist ./worker
USER node
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["tini","--"]
CMD ["node","apps/web/server.js"]
