# Ripipi Backend API

A high-performance reservation system backend built with Fastify, TypeScript, and PostgreSQL.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Docker and Docker Compose
- pnpm (or npm/yarn)

### Development Setup

1. **Clone and install dependencies:**
```bash
pnpm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start the development environment:**
```bash
# Start Docker services (PostgreSQL + Redis)
make dev

# Set up database with migrations and seed data
pnpm run db:setup

# Or just run migrations
pnpm run migrate:up

# Start the development server
pnpm run dev
```

The API will be available at `http://localhost:3000`

### Available Services

- **API Server**: http://localhost:3000
- **pgAdmin**: http://localhost:5050 (admin@example.com / admin)
- **Redis Commander**: http://localhost:8081

## 📁 Project Structure

```
apps/backend/
├── src/                    # Source code
│   ├── config/            # Configuration files
│   ├── db/                # Database connection and helpers
│   ├── middleware/        # Express/Fastify middleware
│   ├── routes/            # API routes
│   │   ├── public/       # Public endpoints
│   │   └── admin/        # Admin endpoints
│   ├── services/          # Business logic
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── validators/        # Request validators
├── migrations/            # Database migrations
├── test/                  # Test files
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   ├── e2e/              # End-to-end tests
│   └── load/             # Load tests
└── scripts/              # Utility scripts
```

## 🛠 Development

### Available Scripts

```bash
# Development
pnpm run dev              # Start dev server with hot reload
pnpm run build            # Build for production
pnpm run start            # Start production server

# Testing
pnpm run test             # Run all tests
pnpm run test:unit        # Run unit tests
pnpm run test:integration # Run integration tests
pnpm run test:e2e         # Run end-to-end tests
pnpm run test:coverage    # Run tests with coverage

# Code Quality
pnpm run lint             # Lint code
pnpm run lint:fix         # Fix linting issues
pnpm run typecheck        # Type check TypeScript

# Database
pnpm run migrate:up       # Run migrations
pnpm run migrate:down     # Rollback migrations
pnpm run migrate:create   # Create new migration
```

### Database Management

```bash
# Using Make commands
make db-backup            # Backup database
make db-restore           # Restore database
make db-reset            # Reset database (CAUTION: drops all data)
make db-seed             # Seed test data
```

## 🔧 Configuration

All configuration is done through environment variables. See `.env.example` for available options.

Key configuration areas:
- **Database**: PostgreSQL connection settings
- **Redis**: Cache and rate limiting configuration  
- **JWT**: Authentication settings
- **Rate Limiting**: API rate limit configuration
- **CORS**: Cross-origin resource sharing settings
- **Stripe**: Payment integration (optional)

## 🏗 Architecture

### Key Technologies

- **Fastify**: High-performance web framework
- **TypeScript**: Type safety and better developer experience
- **PostgreSQL**: Primary database with advanced features
- **Redis**: Caching and rate limiting
- **JWT**: Stateless authentication
- **Stripe**: Payment processing

### Design Principles

1. **Multi-tenancy**: Built-in support for multiple tenants
2. **Type Safety**: Comprehensive TypeScript usage
3. **Performance**: Optimized queries and caching strategies
4. **Security**: Rate limiting, CORS, helmet, and input validation
5. **Scalability**: Horizontal scaling ready with Redis
6. **Maintainability**: Clean architecture and comprehensive testing

## 📚 API Documentation

When running in development mode with `ENABLE_SWAGGER=true`, API documentation is available at:

```
http://localhost:3000/documentation
```

## 🧪 Testing

The project includes comprehensive test coverage:

- **Unit Tests**: Test individual functions and services
- **Integration Tests**: Test API endpoints with real database
- **E2E Tests**: Test complete user workflows
- **Load Tests**: Test performance under load

Run tests with:
```bash
pnpm run test:coverage
```

## 🚀 Deployment

### Production Build

```bash
# Build the application
pnpm run build

# Start production server
NODE_ENV=production pnpm run start
```

### Docker Deployment

```bash
# Build production image
make build-prod

# Run production container
make prod
```

## 🔒 Security

- All passwords are hashed with bcrypt
- JWT tokens for authentication
- Rate limiting on all endpoints
- Input validation with TypeBox
- SQL injection prevention with parameterized queries
- XSS protection with helmet

## 📝 License

ISC

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

For more detailed documentation, see the `/docs` directory.