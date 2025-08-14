# =============================================================================
# RIPIPI RESERVATION SYSTEM - DOCKER MAKEFILE
# =============================================================================
# This Makefile provides convenient commands for managing the Docker environment
# for the reservation system backend.
#
# Usage:
#   make help          - Show available commands
#   make setup         - Initial setup (copy .env, create directories)
#   make dev           - Start development environment
#   make prod          - Start production environment
#   make stop          - Stop all services
#   make clean         - Clean up containers and volumes
# =============================================================================

# Default goal
.DEFAULT_GOAL := help

# Environment variables
COMPOSE_FILE := docker-compose.yml
ENV_FILE := .env
PROJECT_NAME := ripipi

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
MAGENTA := \033[0;35m
CYAN := \033[0;36m
NC := \033[0m # No Color

# =============================================================================
# HELP TARGET
# =============================================================================

.PHONY: help
help: ## Show this help message
	@echo -e "${BLUE}==============================================================================${NC}"
	@echo -e "${BLUE}  RIPIPI RESERVATION SYSTEM - DOCKER COMMANDS${NC}"
	@echo -e "${BLUE}==============================================================================${NC}"
	@echo ""
	@echo -e "${CYAN}Available commands:${NC}"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  ${GREEN}%-20s${NC} %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo -e "${YELLOW}Examples:${NC}"
	@echo -e "  ${GREEN}make setup${NC}          # Initial project setup"
	@echo -e "  ${GREEN}make dev${NC}            # Start development environment"
	@echo -e "  ${GREEN}make logs${NC}           # View logs from all services"
	@echo -e "  ${GREEN}make db-shell${NC}       # Connect to PostgreSQL shell"
	@echo -e "  ${GREEN}make redis-cli${NC}      # Connect to Redis CLI"
	@echo ""

# =============================================================================
# SETUP COMMANDS
# =============================================================================

.PHONY: setup
setup: ## Initial project setup (copy .env, create directories)
	@echo -e "${BLUE}Setting up project environment...${NC}"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo -e "${YELLOW}Copying .env.example to .env...${NC}"; \
		cp .env.example $(ENV_FILE); \
		echo -e "${GREEN}✓ Created .env file${NC}"; \
		echo -e "${YELLOW}⚠️  Please edit .env file with your configuration${NC}"; \
	else \
		echo -e "${GREEN}✓ .env file already exists${NC}"; \
	fi
	@echo -e "${YELLOW}Creating data directories...${NC}"
	@mkdir -p data/postgres data/redis data/pgadmin data/logs
	@echo -e "${GREEN}✓ Data directories created${NC}"
	@echo -e "${BLUE}Setup completed! Run 'make dev' to start development environment.${NC}"

.PHONY: check-env
check-env: ## Check if .env file exists
	@if [ ! -f $(ENV_FILE) ]; then \
		echo -e "${RED}Error: .env file not found!${NC}"; \
		echo -e "${YELLOW}Run 'make setup' first to create the environment file.${NC}"; \
		exit 1; \
	fi

.PHONY: validate-env
validate-env: check-env ## Validate required environment variables
	@echo -e "${BLUE}Validating environment configuration...${NC}"
	@source $(ENV_FILE) && \
	if [ -z "$$POSTGRES_PASSWORD" ] || [ "$$POSTGRES_PASSWORD" = "your_secure_postgres_password_here" ]; then \
		echo -e "${RED}Error: Please set POSTGRES_PASSWORD in .env file${NC}"; \
		exit 1; \
	fi
	@source $(ENV_FILE) && \
	if [ -z "$$JWT_SECRET" ] || [ "$$JWT_SECRET" = "your_jwt_secret_key_minimum_32_characters_long_please_change_this" ]; then \
		echo -e "${RED}Error: Please set JWT_SECRET in .env file${NC}"; \
		exit 1; \
	fi
	@echo -e "${GREEN}✓ Environment validation passed${NC}"

# =============================================================================
# DEVELOPMENT COMMANDS
# =============================================================================

.PHONY: dev
dev: validate-env ## Start development environment with all services
	@echo -e "${BLUE}Starting development environment...${NC}"
	docker-compose --profile development up -d
	@echo -e "${GREEN}✓ Development environment started${NC}"
	@echo -e "${CYAN}Services available:${NC}"
	@echo -e "  Backend API:      http://localhost:3000"
	@echo -e "  PostgreSQL:       localhost:5432"
	@echo -e "  Redis:            localhost:6379"
	@echo -e "  pgAdmin:          http://localhost:5050"
	@echo -e "  Redis Commander:  http://localhost:8081"

.PHONY: dev-full
dev-full: validate-env ## Start development environment with all management tools
	@echo -e "${BLUE}Starting full development environment...${NC}"
	docker-compose --profile full up -d
	@echo -e "${GREEN}✓ Full development environment started${NC}"

.PHONY: dev-minimal
dev-minimal: validate-env ## Start minimal development environment (postgres + redis only)
	@echo -e "${BLUE}Starting minimal development environment...${NC}"
	docker-compose up -d postgres redis
	@echo -e "${GREEN}✓ Minimal development environment started${NC}"

.PHONY: dev-watch
dev-watch: validate-env ## Start development environment with file watching
	@echo -e "${BLUE}Starting development environment with file watching...${NC}"
	docker-compose --profile development up --watch

# =============================================================================
# PRODUCTION COMMANDS
# =============================================================================

.PHONY: prod
prod: validate-env ## Start production environment
	@echo -e "${BLUE}Starting production environment...${NC}"
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo -e "${RED}Error: .env file required for production deployment${NC}"; \
		exit 1; \
	fi
	NODE_ENV=production docker-compose up -d postgres redis backend
	@echo -e "${GREEN}✓ Production environment started${NC}"

.PHONY: prod-build
prod-build: validate-env ## Build and start production environment
	@echo -e "${BLUE}Building and starting production environment...${NC}"
	NODE_ENV=production docker-compose up -d --build postgres redis backend
	@echo -e "${GREEN}✓ Production environment built and started${NC}"

# =============================================================================
# SERVICE MANAGEMENT
# =============================================================================

.PHONY: start
start: check-env ## Start all services
	@echo -e "${BLUE}Starting all services...${NC}"
	docker-compose up -d

.PHONY: stop
stop: ## Stop all services
	@echo -e "${BLUE}Stopping all services...${NC}"
	docker-compose down
	@echo -e "${GREEN}✓ All services stopped${NC}"

.PHONY: restart
restart: stop start ## Restart all services

.PHONY: status
status: ## Show status of all services
	@echo -e "${BLUE}Service status:${NC}"
	@docker-compose ps

.PHONY: logs
logs: ## Show logs from all services
	docker-compose logs -f

.PHONY: logs-backend
logs-backend: ## Show backend service logs
	docker-compose logs -f backend

.PHONY: logs-postgres
logs-postgres: ## Show PostgreSQL logs
	docker-compose logs -f postgres

.PHONY: logs-redis
logs-redis: ## Show Redis logs
	docker-compose logs -f redis

# =============================================================================
# DATABASE COMMANDS
# =============================================================================

.PHONY: db-shell
db-shell: ## Connect to PostgreSQL shell
	@echo -e "${BLUE}Connecting to PostgreSQL shell...${NC}"
	docker-compose exec postgres psql -U $$(grep POSTGRES_USER .env | cut -d= -f2) -d $$(grep POSTGRES_DB .env | cut -d= -f2)

.PHONY: db-migrate
db-migrate: ## Run database migrations
	@echo -e "${BLUE}Running database migrations...${NC}"
	docker-compose exec backend npm run migrate:up

.PHONY: db-migrate-down
db-migrate-down: ## Rollback last migration
	@echo -e "${BLUE}Rolling back last migration...${NC}"
	docker-compose exec backend npm run migrate:down

.PHONY: db-reset
db-reset: ## Reset database (WARNING: This will delete all data!)
	@echo -e "${RED}WARNING: This will delete all database data!${NC}"
	@echo -e "${YELLOW}Are you sure? Type 'yes' to continue:${NC}"
	@read confirmation && [ "$$confirmation" = "yes" ] || (echo "Cancelled" && exit 1)
	docker-compose down
	docker volume rm $$(docker volume ls -q | grep postgres) || true
	docker-compose up -d postgres
	@echo -e "${GREEN}✓ Database reset completed${NC}"

.PHONY: db-backup
db-backup: ## Create database backup
	@echo -e "${BLUE}Creating database backup...${NC}"
	@mkdir -p backups
	docker-compose exec postgres pg_dump -U $$(grep POSTGRES_USER .env | cut -d= -f2) $$(grep POSTGRES_DB .env | cut -d= -f2) > backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo -e "${GREEN}✓ Database backup created in backups/ directory${NC}"

.PHONY: db-restore
db-restore: ## Restore database from backup (Usage: make db-restore BACKUP=backup_file.sql)
	@if [ -z "$(BACKUP)" ]; then \
		echo -e "${RED}Error: Please specify backup file: make db-restore BACKUP=backup_file.sql${NC}"; \
		exit 1; \
	fi
	@echo -e "${BLUE}Restoring database from $(BACKUP)...${NC}"
	docker-compose exec -T postgres psql -U $$(grep POSTGRES_USER .env | cut -d= -f2) $$(grep POSTGRES_DB .env | cut -d= -f2) < $(BACKUP)
	@echo -e "${GREEN}✓ Database restored from $(BACKUP)${NC}"

# =============================================================================
# REDIS COMMANDS
# =============================================================================

.PHONY: redis-cli
redis-cli: ## Connect to Redis CLI
	@echo -e "${BLUE}Connecting to Redis CLI...${NC}"
	docker-compose exec redis redis-cli -a $$(grep REDIS_PASSWORD .env | cut -d= -f2)

.PHONY: redis-flush
redis-flush: ## Flush all Redis data
	@echo -e "${YELLOW}This will delete all Redis data. Continue? (y/N):${NC}"
	@read confirmation && [ "$$confirmation" = "y" ] || (echo "Cancelled" && exit 1)
	docker-compose exec redis redis-cli -a $$(grep REDIS_PASSWORD .env | cut -d= -f2) FLUSHALL
	@echo -e "${GREEN}✓ Redis data flushed${NC}"

# =============================================================================
# TESTING COMMANDS
# =============================================================================

.PHONY: test
test: ## Run all tests
	@echo -e "${BLUE}Running tests...${NC}"
	docker-compose exec backend npm test

.PHONY: test-unit
test-unit: ## Run unit tests
	docker-compose exec backend npm run test:unit

.PHONY: test-integration
test-integration: ## Run integration tests
	docker-compose exec backend npm run test:integration

.PHONY: test-e2e
test-e2e: ## Run end-to-end tests
	docker-compose exec backend npm run test:e2e

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	docker-compose exec backend npm run test:coverage

# =============================================================================
# BUILD AND DEVELOPMENT
# =============================================================================

.PHONY: build
build: ## Build all Docker images
	@echo -e "${BLUE}Building Docker images...${NC}"
	docker-compose build
	@echo -e "${GREEN}✓ Docker images built${NC}"

.PHONY: build-no-cache
build-no-cache: ## Build Docker images without cache
	@echo -e "${BLUE}Building Docker images without cache...${NC}"
	docker-compose build --no-cache
	@echo -e "${GREEN}✓ Docker images built without cache${NC}"

.PHONY: shell
shell: ## Open shell in backend container
	docker-compose exec backend /bin/bash

.PHONY: install
install: ## Install/update npm dependencies
	docker-compose exec backend npm install

.PHONY: lint
lint: ## Run code linting
	docker-compose exec backend npm run lint

.PHONY: lint-fix
lint-fix: ## Fix linting issues
	docker-compose exec backend npm run lint:fix

# =============================================================================
# CLEANUP COMMANDS
# =============================================================================

.PHONY: clean
clean: stop ## Stop services and remove containers
	@echo -e "${BLUE}Cleaning up containers...${NC}"
	docker-compose down --remove-orphans
	@echo -e "${GREEN}✓ Containers cleaned up${NC}"

.PHONY: clean-volumes
clean-volumes: ## Remove all data volumes (WARNING: This deletes all data!)
	@echo -e "${RED}WARNING: This will delete all persistent data!${NC}"
	@echo -e "${YELLOW}Are you sure? Type 'yes' to continue:${NC}"
	@read confirmation && [ "$$confirmation" = "yes" ] || (echo "Cancelled" && exit 1)
	docker-compose down -v
	@echo -e "${GREEN}✓ Volumes cleaned up${NC}"

.PHONY: clean-all
clean-all: ## Remove containers, volumes, and images
	@echo -e "${RED}WARNING: This will delete all containers, volumes, and images!${NC}"
	@echo -e "${YELLOW}Are you sure? Type 'yes' to continue:${NC}"
	@read confirmation && [ "$$confirmation" = "yes" ] || (echo "Cancelled" && exit 1)
	docker-compose down -v --rmi all --remove-orphans
	@echo -e "${GREEN}✓ Complete cleanup finished${NC}"

.PHONY: prune
prune: ## Clean up unused Docker resources
	@echo -e "${BLUE}Cleaning up unused Docker resources...${NC}"
	docker system prune -f
	@echo -e "${GREEN}✓ Docker resources pruned${NC}"

# =============================================================================
# HEALTH CHECK COMMANDS
# =============================================================================

.PHONY: health
health: ## Check health of all services
	@echo -e "${BLUE}Checking service health...${NC}"
	@for service in $$(docker-compose ps --services); do \
		if docker-compose ps $$service | grep -q "Up.*healthy"; then \
			echo -e "${GREEN}✓ $$service: healthy${NC}"; \
		elif docker-compose ps $$service | grep -q "Up"; then \
			echo -e "${YELLOW}⚠ $$service: running (no health check)${NC}"; \
		else \
			echo -e "${RED}✗ $$service: not running${NC}"; \
		fi \
	done

.PHONY: wait-for-db
wait-for-db: ## Wait for database to be ready
	@echo -e "${BLUE}Waiting for database to be ready...${NC}"
	@timeout 60 bash -c 'until docker-compose exec postgres pg_isready -U $$(grep POSTGRES_USER .env | cut -d= -f2); do sleep 1; done' || (echo -e "${RED}Database failed to start${NC}" && exit 1)
	@echo -e "${GREEN}✓ Database is ready${NC}"

# =============================================================================
# UTILITY COMMANDS
# =============================================================================

.PHONY: ps
ps: ## Show running containers
	docker-compose ps

.PHONY: top
top: ## Show container resource usage
	docker-compose top

.PHONY: exec-backend
exec-backend: ## Execute command in backend container (Usage: make exec-backend CMD="your command")
	docker-compose exec backend $(CMD)

.PHONY: exec-postgres
exec-postgres: ## Execute command in postgres container (Usage: make exec-postgres CMD="your command")
	docker-compose exec postgres $(CMD)

.PHONY: exec-redis
exec-redis: ## Execute command in redis container (Usage: make exec-redis CMD="your command")
	docker-compose exec redis $(CMD)

# =============================================================================
# MONITORING COMMANDS
# =============================================================================

.PHONY: stats
stats: ## Show container statistics
	docker stats $$(docker-compose ps -q)

.PHONY: inspect
inspect: ## Inspect Docker Compose configuration
	docker-compose config

.PHONY: ports
ports: ## Show exposed ports
	@echo -e "${BLUE}Exposed ports:${NC}"
	@docker-compose ps --format table