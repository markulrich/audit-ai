FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "--import", "tsx", "server/index.ts"]
