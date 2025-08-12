FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm fetch
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN pnpm install --offline && pnpm build || true
CMD ["node","dist/server.js"]