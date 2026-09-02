# Lab Unity — Backend API

Production-grade REST API for the **Lab Unity** laboratory professional network and marketplace. Built with Node.js, Express, TypeScript, PostgreSQL and Prisma following Clean Architecture principles.

## Table of contents

- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database & Prisma](#database--prisma)
- [Authentication flow](#authentication-flow)
- [Roles & access control](#roles--access-control)
- [Response & error format](#response--error-format)
- [Validation strategy](#validation-strategy)
- [Security](#security)
- [API reference](#api-reference)
- [Scripts](#scripts)

## Tech stack

| Concern          | Choice                                 |
| ---------------- | -------------------------------------- |
| Runtime          | Node.js 18+                            |
| Framework        | Express 4                              |
| Language         | TypeScript (strict)                    |
| Database         | PostgreSQL                             |
| ORM              | Prisma                                 |
| Validation       | Zod                                    |
| Auth             | JWT (access + rotating refresh tokens) |
| Password hashing | bcryptjs                               |
| File uploads     | Multer (local disk)                    |
| Logging          | pino / pino-http                       |
| Security         | helmet, cors, express-rate-limit       |

## Architecture

The codebase follows **Clean Architecture** with a strict, one-directional dependency flow:

```
HTTP Request
   │
   ▼
Route  ──►  Middleware (auth, RBAC, validation, rate-limit, upload)
   │
   ▼
Controller  (thin — parses req/res, delegates)
   │
   ▼
Service / Use-case  (business rules, orchestration, transactions)
   │
   ▼
Prisma (repository / data-access)  ──►  PostgreSQL
```

Cross-cutting concerns (config, error handling, logging, serializers, utilities) live in dedicated shared layers so they can be reused without coupling modules together.

Principles applied: **SOLID**, **DRY**, **KISS**, **Separation of Concerns**, **Dependency Inversion** (services depend on abstractions provided by the shared layer), centralized error handling, centralized validation, and consistent naming.

## Project structure

```
server/
├── prisma/
│   ├── schema.prisma          # Data model, enums, relations, indexes
│   └── seed.ts                # Idempotent seed (admin + demo users + sample data)
├── src/
│   ├── config/                # env parsing, logger
│   ├── infrastructure/        # Prisma client + connection lifecycle
│   ├── middleware/            # authenticate, authorize, validate, error, upload, rate-limit
│   ├── modules/               # Feature modules (see below)
│   │   └── <feature>/
│   │       ├── <feature>.validators.ts   # Zod schemas
│   │       ├── <feature>.service.ts      # Business logic (use-cases)
│   │       ├── <feature>.controller.ts   # HTTP adapters
│   │       └── <feature>.routes.ts       # Route wiring + middleware
│   ├── routes/                # Aggregated API router (versioned)
│   ├── shared/                # errors, http helpers, serializers, utils
│   ├── types/                 # Express type augmentation
│   ├── app.ts                 # Express app assembly
│   └── server.ts              # Bootstrap + graceful shutdown
├── .env.example
└── docs/API.md                # Full endpoint reference
```

**Modules:** `auth`, `users`, `connections`, `feed`, `marketplace`, `recruitment`, `general`, `blogs`, `messages`, `notifications`, `advertisements`, `reports`, `subscriptions`, `admin`, `uploads`.

## Getting started

### Prerequisites

- Node.js 18+
- PostgreSQL 13+

### Setup

```bash
cd server
cp .env.example .env          # then edit values (DATABASE_URL, JWT secrets, ...)
npm install
npm run prisma:generate       # generate the Prisma client
npm run prisma:migrate        # create the database schema (dev migration)
npm run db:seed               # optional: seed demo data
npm run dev                   # start with hot reload (http://localhost:4000)
```

Health check: `GET http://localhost:4000/api/v1/health`

### Demo accounts (after seeding)

Password for all: value of `SEED_ADMIN_PASSWORD` (default `Demo123!`).

| Role     | Email                   |
| -------- | ----------------------- |
| Admin    | admin.lab@gmail.com     |
| User     | user.lab@gmail.com      |
| Supplier | tradesman.lab@gmail.com |

## Environment variables

See [.env.example](.env.example). Key values:

| Variable                 | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection string              |
| `JWT_ACCESS_SECRET`      | Secret for short-lived access tokens      |
| `JWT_REFRESH_SECRET`     | Secret for refresh tokens                 |
| `JWT_ACCESS_EXPIRES_IN`  | Access token TTL (e.g. `15m`)             |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (e.g. `7d`)             |
| `CORS_ORIGINS`           | Comma-separated allowed origins           |
| `UPLOAD_DIR`             | Directory for uploaded files              |
| `PUBLIC_URL`             | Base URL used to build absolute file URLs |
| `RATE_LIMIT_*`           | Global rate-limit window/size             |

## Database & Prisma

The schema models 20+ entities including users/profiles/subscriptions, connections, feed posts + comments + reactions, marketplace listings + saves, jobs + applications, general posts, blogs, conversations + messages, notifications, supplier advertisements, and moderation reports + logs.

- Monetary values (`price`, `amount`) are stored as **integer cents** and serialized to decimal in responses.
- Indexes are defined on foreign keys, status/category enums and `createdAt` to keep list/filter queries fast.
- Critical multi-step operations (connections, moderation, subscriptions) run inside `prisma.$transaction`.

Common commands:

```bash
npm run prisma:migrate     # dev migration + client regen
npm run prisma:deploy      # apply migrations in production
npm run prisma:studio      # visual data browser
npm run db:seed            # seed demo data
```

## Authentication flow

1. **Register** (`POST /auth/register`) — creates the user, profile and a trial subscription. `profileType = supplier` maps to the `SUPPLIER` role; every other type maps to `USER`. Returns `{ user, accessToken, refreshToken }`.
2. **Login** (`POST /auth/login`) — verifies credentials, blocks suspended/banned accounts, returns a token pair.
3. **Access token** — short-lived JWT sent as `Authorization: Bearer <token>`.
4. **Refresh** (`POST /auth/refresh`) — refresh tokens are hashed at rest and **rotated** on every use (the old token is revoked).
5. **Logout** (`POST /auth/logout`) — revokes the supplied refresh token.

## Roles & access control

`authenticate` verifies the JWT and attaches `req.user`. `authorize(...roles)` restricts routes.

| Role       | Capabilities                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `USER`     | Feed, contacts, marketplace, recruitment (browse/apply/post), general, messages, notifications, subscriptions, own profile |
| `SUPPLIER` | Advertisements (own CRUD), post jobs, contacts, general, messages, blogs (read), own profile                               |
| `ADMIN`    | User management, moderation/reports, ad approval, blog CRUD, dashboard/statistics, settings                                |

Ownership checks are enforced in services (a user may only mutate their own resources; admins may override where appropriate).

## Response & error format

**Success**

```json
{
  "success": true,
  "data": {},
  "meta": { "page": 1, "pageSize": 12, "total": 42, "totalPages": 4 }
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "path": "email", "message": "Invalid email" }]
  }
}
```

Error codes: `VALIDATION_ERROR` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `BAD_REQUEST` (400), `INTERNAL_ERROR` (500). Prisma and JWT errors are normalized into this shape by the central error handler.

## Validation strategy

All input is validated at the boundary with **Zod** via the `validate({ body, query, params })` middleware. Parsed, coerced, sanitized values replace the raw request data, so controllers and services always work with trusted, typed input. Password policy (min 8 chars, upper + digit + symbol) mirrors the frontend.

## Security

- Passwords hashed with bcrypt (configurable rounds).
- JWT access/refresh split; refresh tokens hashed in the DB and rotated.
- `helmet` security headers, configurable `cors` allow-list.
- Global + stricter auth rate limiting.
- Zod validation on every endpoint (mitigates injection / mass-assignment).
- Prisma parameterized queries (no raw string interpolation).
- Upload MIME-type allow-list and size limits.
- Suspended/banned accounts blocked at login.
- No sensitive fields (`passwordHash`) are ever serialized.

## API reference

See [docs/API.md](docs/API.md) for the full endpoint catalogue. All routes are prefixed with `API_PREFIX` (default `/api/v1`).

## Scripts

| Script                   | Description                      |
| ------------------------ | -------------------------------- |
| `npm run dev`            | Start dev server with hot reload |
| `npm run build`          | Compile TypeScript to `dist/`    |
| `npm start`              | Run compiled server              |
| `npm run typecheck`      | Type-check without emitting      |
| `npm run lint`           | Lint sources                     |
| `npm run prisma:migrate` | Create/apply a dev migration     |
| `npm run prisma:deploy`  | Apply migrations (production)    |
| `npm run db:seed`        | Seed demo data                   |
#   m o h a m m a d _ s e r v e r  
 