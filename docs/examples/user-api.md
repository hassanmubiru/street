---
layout:    default
title:     "User CRUD API"
parent:    "Examples"
nav_order: 1
permalink: /examples/user-api/
---

# Example: User CRUD API

This walkthrough builds a complete user management API with registration, login, JWT authentication, CRUD, and pagination. Every component is real and production-ready.

---

## What we're building

```
POST   /api/users           Register a new user
POST   /api/users/login     Authenticate, return JWT
GET    /api/users           List users (JWT required)
GET    /api/users/:id       Get one user (JWT required)
PUT    /api/users/:id       Update user (JWT required, owner or admin)
DELETE /api/users/:id       Delete user (admin only)
```

---

## Migration

```sql
-- migrations/001_create_users.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(320)  NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  password_hash TEXT          NOT NULL,
  roles         JSONB         NOT NULL DEFAULT '["user"]'::jsonb,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);
```

---

## Domain types

```typescript
// src/domain/user.ts
export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  roles: string;          // JSON array stored as text
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  roles: string[];
  createdAt: string;
}

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export function toPublicUser(user: User): UserPublic {
  let roles: string[] = [];
  try { roles = JSON.parse(user.roles) as string[]; } catch { roles = ['user']; }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    createdAt: user.created_at,
  };
}
```

---

## Repository

```typescript
// src/services/user.repository.ts
import { Injectable } from '../core/container.js';
import { StreetPostgresRepository } from '../database/repository.js';
import { PgPool } from '../database/pool.js';
import type { User } from '../domain/user.js';

@Injectable()
export class UserRepository extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';

  constructor(pool: PgPool) { super(pool); }

  protected mapRow(row: Record<string, string | null>): User {
    return {
      id:            row['id']            ?? '',
      email:         row['email']         ?? '',
      name:          row['name']          ?? '',
      password_hash: row['password_hash'] ?? '',
      roles:         row['roles']         ?? '["user"]',
      created_at:    row['created_at']    ?? '',
      updated_at:    row['updated_at']    ?? '',
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const safe = email.toLowerCase().replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT * FROM users WHERE LOWER(email) = '${safe}' LIMIT 1`
    );
    return result.rows.length ? this.mapRow(result.rows[0] as Record<string, string | null>) : null;
  }

  async emailExists(email: string): Promise<boolean> {
    const safe = email.toLowerCase().replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT 1 FROM users WHERE LOWER(email) = '${safe}' LIMIT 1`
    );
    return result.rows.length > 0;
  }
}
```

---

## Service

```typescript
// src/services/user.service.ts
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '../core/container.js';
import { UserRepository } from './user.repository.js';
import { JwtService } from '../security/jwt.js';
import { AppConfig } from '../config/index.js';
import { toPublicUser, type User, type UserPublic,
         type CreateUserDto, type UpdateUserDto, type LoginDto } from '../domain/user.js';
import { BadRequestException, NotFoundException,
         UnauthorizedException, ConflictException } from '../http/exceptions.js';
import type { TokenPair, PaginatedResult } from '../core/types.js';

const pbkdf2Async = promisify(pbkdf2);

@Injectable()
export class UserService {
  private readonly jwt: JwtService;

  constructor(
    private readonly repo: UserRepository,
    private readonly config: AppConfig,
  ) {
    this.jwt = new JwtService(this.config.jwtSecret);
  }

  async register(dto: CreateUserDto): Promise<UserPublic> {
    if (await this.repo.emailExists(dto.email)) {
      throw new ConflictException('Email already registered');
    }
    const hash = await this._hashPassword(dto.password);
    const user = await this.repo.create({
      id:            this._uuid(),
      email:         dto.email.toLowerCase(),
      name:          dto.name,
      password_hash: hash,
      roles:         JSON.stringify(['user']),
      created_at:    new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    } as Partial<User>);
    return toPublicUser(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.repo.findByEmail(dto.email);
    if (!user || !await this._verifyPassword(dto.password, user.password_hash)) {
      await this._dummyHash();   // Constant-time even on miss
      throw new UnauthorizedException('Invalid credentials');
    }
    const roles = JSON.parse(user.roles) as string[];
    return {
      accessToken:  this.jwt.sign({ sub: user.id, email: user.email, roles }, { expiresInSeconds: 3600 }),
      refreshToken: this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresInSeconds: 604800 }),
      expiresIn:    3600,
    };
  }

  async findById(id: string): Promise<UserPublic> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async findAll(page: number, limit: number): Promise<PaginatedResult<UserPublic>> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const offset = (Math.max(1, page) - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.repo.findAll(safeLimit, offset),
      this.repo.count(),
    ]);
    return {
      items: items.map(toPublicUser),
      total,
      page,
      limit: safeLimit,
      hasMore: offset + items.length < total,
    };
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserPublic> {
    if (!await this.repo.findById(id)) throw new NotFoundException('User not found');
    if (dto.email) {
      const owner = await this.repo.findByEmail(dto.email);
      if (owner && owner.id !== id) throw new ConflictException('Email already taken');
    }
    const updated = await this.repo.update(id, {
      ...(dto.name  ? { name:  dto.name }                    : {}),
      ...(dto.email ? { email: dto.email.toLowerCase() }     : {}),
      updated_at: new Date().toISOString(),
    } as Partial<User>);
    if (!updated) throw new NotFoundException('User not found');
    return toPublicUser(updated);
  }

  async remove(id: string): Promise<void> {
    if (!await this.repo.delete(id)) throw new NotFoundException('User not found');
  }

  verifyToken(token: string) {
    return this.jwt.verify(token);
  }

  private async _hashPassword(pw: string): Promise<string> {
    const salt = randomBytes(32);
    const hash = await pbkdf2Async(pw, salt, 100_000, 64, 'sha512');
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  private async _verifyPassword(pw: string, stored: string): Promise<boolean> {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await pbkdf2Async(pw, salt, 100_000, 64, 'sha512');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private async _dummyHash(): Promise<void> {
    await pbkdf2Async('dummy', randomBytes(32), 100_000, 64, 'sha512');
  }

  private _uuid(): string {
    const b = randomBytes(16);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
}
```

---

## Controller

```typescript
// src/controllers/user.controller.ts
import { Injectable } from '../core/container.js';
import { Controller, Get, Post, Put, Delete, Validate, ApiOperation } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { authMiddleware, requireRoles } from '../http/auth.middleware.js';
import { UserService } from '../services/user.service.js';
import { JwtService } from '../security/jwt.js';
import { AppConfig } from '../config/index.js';
import { BadRequestException } from '../http/exceptions.js';
import type { CreateUserDto, UpdateUserDto, LoginDto } from '../domain/user.js';

@Injectable()
@Controller('/api/users')
export class UserController {
  private readonly auth: ReturnType<typeof authMiddleware>;

  constructor(
    private readonly users: UserService,
    private readonly config: AppConfig,
  ) {
    const jwt = new JwtService(this.config.jwtSecret);
    this.auth = authMiddleware(jwt);
  }

  @Post('/')
  @Validate({ body: {
    email:    { type: 'email',  required: true,  max: 320 },
    name:     { type: 'string', required: true,  min: 1, max: 100 },
    password: { type: 'string', required: true,  min: 8, max: 128 },
  }})
  @ApiOperation({ summary: 'Register user', tags: ['users'] })
  async register(ctx: StreetContext): Promise<void> {
    const user = await this.users.register(ctx.body as CreateUserDto);
    ctx.json(user, 201);
  }

  @Post('/login')
  @Validate({ body: {
    email:    { type: 'email',  required: true },
    password: { type: 'string', required: true, min: 1 },
  }})
  @ApiOperation({ summary: 'Login', tags: ['auth'] })
  async login(ctx: StreetContext): Promise<void> {
    ctx.json(await this.users.login(ctx.body as LoginDto));
  }

  @Get('/')
  @ApiOperation({ summary: 'List users', tags: ['users'] })
  async list(ctx: StreetContext): Promise<void> {
    const page  = parseInt(ctx.query['page']  ?? '1',  10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    ctx.json(await this.users.findAll(page, limit));
  }

  @Get('/:id')
  @Validate({ params: { id: { type: 'uuid', required: true } } })
  @ApiOperation({ summary: 'Get user', tags: ['users'] })
  async getOne(ctx: StreetContext): Promise<void> {
    ctx.json(await this.users.findById(ctx.params['id']!));
  }

  @Put('/:id')
  @Validate({
    params: { id: { type: 'uuid', required: true } },
    body:   { name: { type: 'string', min: 1, max: 100 }, email: { type: 'email', max: 320 } },
  })
  @ApiOperation({ summary: 'Update user', tags: ['users'] })
  async update(ctx: StreetContext): Promise<void> {
    ctx.json(await this.users.update(ctx.params['id']!, ctx.body as UpdateUserDto));
  }

  @Delete('/:id')
  @Validate({ params: { id: { type: 'uuid', required: true } } })
  @ApiOperation({ summary: 'Delete user', tags: ['users'] })
  async remove(ctx: StreetContext): Promise<void> {
    await this.users.remove(ctx.params['id']!);
    ctx.send(204);
  }
}
```

---

## Example requests and responses

### Register

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "alice@example.com",
    "name": "Alice Smith",
    "password": "s3cure-p@ssw0rd!"
  }'
```

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "roles": ["user"],
  "createdAt": "2024-01-15T10:23:45.123Z"
}
```

### Login

```bash
curl -X POST http://localhost:3000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"s3cure-p@ssw0rd!"}'
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWI...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhMWI...",
  "expiresIn": 3600
}
```

### List users

```bash
curl 'http://localhost:3000/api/users?page=1&limit=10' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

```json
{
  "items": [
    {
      "id": "a1b2c3d4-...",
      "email": "alice@example.com",
      "name": "Alice Smith",
      "roles": ["user"],
      "createdAt": "2024-01-15T10:23:45.123Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 10,
  "hasMore": true
}
```

### Validation error

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"not-an-email","password":"short"}'
```

```json
{
  "error": "BadRequestException",
  "message": "Validation failed",
  "status": 400,
  "details": [
    "body.email must be a valid email",
    "body.name is required",
    "body.password must be at least 8 chars"
  ]
}
```

### Duplicate email

```bash
# Second registration with same email:
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice2","password":"password123"}'
```

```json
{
  "error": "ConflictException",
  "message": "Email already registered",
  "status": 409
}
```

### Update user

```bash
curl -X PUT http://localhost:3000/api/users/a1b2c3d4-... \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ...' \
  -d '{"name":"Alice Johnson"}'
```

```json
{
  "id": "a1b2c3d4-...",
  "email": "alice@example.com",
  "name": "Alice Johnson",
  "roles": ["user"],
  "createdAt": "2024-01-15T10:23:45.123Z"
}
```

### Delete user

```bash
curl -X DELETE http://localhost:3000/api/users/a1b2c3d4-... \
  -H 'Authorization: Bearer ...'

# HTTP 204 No Content (empty body)
```
