# my-app

A [Street](https://hassanmubiru.github.io/street) framework application.

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14 (optional, for database features)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
street dev
```

## Available Commands

| Command                    | Description                        |
| -------------------------- | ---------------------------------- |
| `street dev`              | Start development server           |
| `street build`            | Compile for production             |
| `street start`            | Start production server            |
| `street test`             | Run tests                          |
| `street migrate:run`      | Run pending migrations             |
| `street migrate:create`   | Create a new migration file        |

## Project Structure

```
src/
├── controllers/    # HTTP request handlers
├── services/       # Business logic
├── repositories/   # Data access layer
├── middleware/      # Custom middleware
├── gateways/        # WebSocket handlers
└── main.ts         # Application entry point
```

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Production start
npm run test         # Run tests
npm run migrate      # Run migrations
```
