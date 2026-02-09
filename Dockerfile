FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .

# Capture build metadata from git before building
RUN echo "{\"commitSha\":\"$(git rev-parse HEAD 2>/dev/null || echo unknown)\",\"commitTitle\":\"$(git log -1 --pretty=%s 2>/dev/null || echo unknown)\",\"buildTime\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > build-info.json

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "--import", "tsx", "server/index.ts"]
