# Docker Environment Setup for Ripipi Reservation System

This document provides instructions for setting up and running the Ripipi Reservation System backend using Docker.

## Quick Start

1. **Initial Setup**
   ```bash
   make setup
   ```
   This creates the `.env` file and necessary data directories.

2. **Configure Environment**
   Edit the `.env` file and update the following required values:
   - `POSTGRES_PASSWORD` - Set a secure password for PostgreSQL
   - `REDIS_PASSWORD` - Set a secure password for Redis
   - `JWT_SECRET` - Set a strong JWT secret (minimum 32 characters)

3. **Start Development Environment**
   ```bash
   make dev
   ```

4. **Access Services**
   - Backend API: http://localhost:3000
   - pgAdmin: http://localhost:5050
   - Redis Commander: http://localhost:8081

## Available Commands

Use `make help` to see all available commands. Key commands include:

### Environment Management
- `make setup` - Initial project setup
- `make dev` - Start development environment
- `make prod` - Start production environment
- `make stop` - Stop all services
- `make clean` - Clean up containers

### Database Operations
- `make db-shell` - Connect to PostgreSQL shell
- `make db-migrate` - Run database migrations
- `make db-backup` - Create database backup
- `make db-reset` - Reset database (WARNING: deletes all data)

### Redis Operations
- `make redis-cli` - Connect to Redis CLI
- `make redis-flush` - Flush all Redis data

### Development
- `make logs` - View logs from all services
- `make test` - Run tests
- `make shell` - Open shell in backend container

## Services

### PostgreSQL 16
- **Port**: 5432
- **Database**: ripipi_reservations
- **Features**: Optimized configuration, health checks, automatic initialization
- **Management**: pgAdmin available on port 5050

### Redis 7
- **Port**: 6379
- **Usage**: Caching and rate limiting
- **Features**: Optimized for cache workloads, persistence enabled
- **Management**: Redis Commander available on port 8081

### Backend API
- **Port**: 3000
- **Features**: Hot reloading in development, health checks
- **Endpoints**: 
  - Health check: `/health`
  - API documentation: `/docs` (when enabled)

## Environment Profiles

### Development Profile
```bash
make dev
```
Includes all services plus management tools (pgAdmin, Redis Commander).

### Production Profile
```bash
make prod
```
Includes only essential services (PostgreSQL, Redis, Backend).

### Minimal Profile
```bash
make dev-minimal
```
Includes only database services (PostgreSQL, Redis).

## Data Persistence

All data is persisted in the `./data/` directory:
- `data/postgres/` - PostgreSQL data
- `data/redis/` - Redis data
- `data/pgadmin/` - pgAdmin configuration
- `data/logs/` - Application logs

## Health Checks

All services include health checks:
- **PostgreSQL**: `pg_isready` command
- **Redis**: Connection test with `redis-cli`
- **Backend**: HTTP health endpoint

## Security Features

- Non-root users in containers
- Secure password authentication (scram-sha-256)
- Environment variable-based configuration
- Network isolation
- Resource limits and optimizations

## Troubleshooting

### Common Issues

1. **Permission Denied Errors**
   ```bash
   chmod +x scripts/init-db.sh
   ```

2. **Port Already in Use**
   Check and modify ports in `.env` file:
   ```
   POSTGRES_PORT=5433
   REDIS_PORT=6380
   ```

3. **Database Connection Issues**
   Wait for services to be healthy:
   ```bash
   make wait-for-db
   make health
   ```

4. **Memory Issues**
   Adjust resource limits in `docker-compose.yml` or increase Docker memory allocation.

### Logs and Debugging

- View all logs: `make logs`
- View specific service logs: `make logs-backend`, `make logs-postgres`, `make logs-redis`
- Check service health: `make health`
- Monitor resources: `make stats`

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in `.env`
2. Use strong passwords for all services
3. Configure proper CORS origins
4. Set up SSL/TLS termination (reverse proxy)
5. Configure monitoring and alerting
6. Set up automated backups
7. Review and adjust resource limits

Example production startup:
```bash
NODE_ENV=production make prod
```

## Backup and Restore

### Database Backup
```bash
make db-backup
```

### Database Restore
```bash
make db-restore BACKUP=backups/backup_20240814_120000.sql
```

## Development Workflow

1. Start development environment: `make dev`
2. Make code changes (hot reloading enabled)
3. Run tests: `make test`
4. Check logs: `make logs-backend`
5. Access database: `make db-shell`
6. Run migrations: `make db-migrate`

## Configuration Reference

Key environment variables:
- `POSTGRES_*` - PostgreSQL configuration
- `REDIS_*` - Redis configuration
- `JWT_SECRET` - Authentication secret
- `CORS_ORIGIN` - Allowed origins
- `LOG_LEVEL` - Logging level
- `STRIPE_*` - Payment configuration

See `.env.example` for complete reference.