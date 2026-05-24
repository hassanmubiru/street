// src/services/user.repository.ts
// User repository with typed row mapping.

import { StreetPostgresRepository } from '../database/repository.js';
import { PgPool } from '../database/pool.js';
import { Injectable } from '../core/container.js';
import type { User } from '../domain/user.js';

@Injectable()
export class UserRepository extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';

  constructor(pool: PgPool) {
    super(pool);
  }

  protected mapRow(row: Record<string, string | null>): User {
    return {
      id: row['id'] ?? '',
      email: row['email'] ?? '',
      name: row['name'] ?? '',
      password_hash: row['password_hash'] ?? '',
      roles: row['roles'] ?? '["user"]',
      created_at: row['created_at'] ?? new Date().toISOString(),
      updated_at: row['updated_at'] ?? new Date().toISOString(),
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const safe = email.replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT * FROM users WHERE email = '${safe}' LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0] as Record<string, string | null>);
  }

  async emailExists(email: string): Promise<boolean> {
    const safe = email.replace(/'/g, "''");
    const result = await this.pool.query(
      `SELECT 1 FROM users WHERE email = '${safe}' LIMIT 1`
    );
    return result.rows.length > 0;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    const safeId = id.replace(/'/g, "''");
    const safeHash = passwordHash.replace(/'/g, "''");
    await this.pool.query(
      `UPDATE users SET password_hash = '${safeHash}', updated_at = NOW() WHERE id = '${safeId}'`
    );
  }
}
