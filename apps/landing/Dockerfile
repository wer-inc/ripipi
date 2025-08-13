FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

# Copy root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy app files
COPY apps/landing ./apps/landing

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
WORKDIR /app/apps/landing
RUN pnpm build

# Production stage
FROM node:20-alpine
WORKDIR /app
RUN corepack enable

COPY --from=builder /app/apps/landing/.next/standalone ./
COPY --from=builder /app/apps/landing/.next/static ./apps/landing/.next/static
COPY --from=builder /app/apps/landing/public ./apps/landing/public

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/landing/server.js"]