.PHONY: help dev prod build up down logs ps clean reset db-migrate db-seed

# Default target
help:
	@echo "Ripipi Docker Commands:"
	@echo "  make dev        - Start development environment"
	@echo "  make prod       - Start production environment"
	@echo "  make build      - Build all Docker images"
	@echo "  make up         - Start all services"
	@echo "  make down       - Stop all services"
	@echo "  make logs       - Show logs for all services"
	@echo "  make ps         - Show running services"
	@echo "  make clean      - Remove all containers and volumes"
	@echo "  make reset      - Clean and restart development"
	@echo "  make db-migrate - Run database migrations"
	@echo "  make db-seed    - Seed database with test data"

# Development commands
dev:
	docker-compose up -d

dev-build:
	docker-compose build

dev-logs:
	docker-compose logs -f

# Production commands
prod:
	docker-compose -f docker-compose.prod.yaml up -d

prod-build:
	docker-compose -f docker-compose.prod.yaml build

prod-logs:
	docker-compose -f docker-compose.prod.yaml logs -f

# Common commands
build: dev-build

up: dev

down:
	docker-compose down

logs: dev-logs

ps:
	docker-compose ps

clean:
	docker-compose down -v
	docker system prune -f

reset: clean dev

# Database commands
db-migrate:
	docker-compose exec api pnpm drizzle-kit push:pg

db-seed:
	docker-compose exec api pnpm tsx src/seed.ts

# Service-specific commands
api-shell:
	docker-compose exec api sh

db-shell:
	docker-compose exec db psql -U devuser -d liffapp

# Individual service restart
restart-api:
	docker-compose restart api

restart-admin:
	docker-compose restart admin-web

restart-landing:
	docker-compose restart landing

restart-liff:
	docker-compose restart liff-demo