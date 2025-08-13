FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

# Copy root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy app files
COPY apps/admin-web ./apps/admin-web

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
WORKDIR /app/apps/admin-web
RUN pnpm build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]