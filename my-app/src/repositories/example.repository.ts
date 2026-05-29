// src/repositories/example.repository.ts
// Example repository using the Street framework's PostgreSQL pool directly.

import { Injectable, container, PgPool } from '@streetjs/core';
import type { PgRow } from '@streetjs/core';
import type { Item } from '../services/example.service.js';

/** Map a database row to an Item */
function rowToItem(row: PgRow): Item {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    createdAt: new Date(String(row['created_at'] ?? Date.now())),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
  };
}

@Injectable()
export class ExampleRepository {
  private readonly pool = container.resolve(PgPool);

  async findAll(page: number, limit: number): Promise<{ items: Item[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);

    const items = dataResult.rows.map(rowToItem);
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = $1',
      [id]
    );
    const row = result.rows[0];
    return row ? rowToItem(row) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      `INSERT INTO items (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.id, item.name, item.description, item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      `UPDATE items
       SET name = $1, description = $2, updated_at = $3
       WHERE id = $4`,
      [item.name, item.description, item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = $1', [id]);
  }
}
