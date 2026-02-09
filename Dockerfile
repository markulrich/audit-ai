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
EXPOSE 8080

# Entrypoint selects between main server and worker modes.
# When WORKER_MODE=true, the machine runs the worker agent process.
# Otherwise, it runs the main control plane server.
CMD ["sh", "-c", "if [ \"$WORKER_MODE\" = \"true\" ]; then node --import tsx server/worker.ts; else node --import tsx server/index.ts; fi"]
