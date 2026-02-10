FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Accept build metadata as build args instead of requiring git in the image
ARG COMMIT_SHA=unknown
ARG COMMIT_TITLE=unknown
RUN echo "{\"commitSha\":\"${COMMIT_SHA}\",\"commitTitle\":\"${COMMIT_TITLE}\",\"buildTime\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > build-info.json

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# tsx is needed at runtime for TypeScript server — copy from builder
# to preserve the lockfile-pinned version
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx

# Copy built frontend and server source from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build-info.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "--import", "tsx", "server/index.ts"]
