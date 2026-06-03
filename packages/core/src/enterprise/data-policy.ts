// src/enterprise/data-policy.ts
// Data retention, field-level encryption decorators, and compliance reporting.

export type DataClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Marks a property with a retention duration (e.g. '90d', '1y').
 * Metadata key: 'street:retention'
 */
export function RetainFor(duration: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: Record<string, string> =
      (Reflect.getMetadata('street:retention', target.constructor) as Record<string, string> | undefined) ?? {};
    existing[key] = duration;
    Reflect.defineMetadata('street:retention', existing, target.constructor);
  };
}

/**
 * Marks a property for transparent AES-256-GCM field-level encryption.
 * Metadata key: 'street:encrypt'
 */
export function Encrypt(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: string[] =
      (Reflect.getMetadata('street:encrypt', target.constructor) as string[] | undefined) ?? [];
    if (!existing.includes(key)) existing.push(key);
    Reflect.defineMetadata('street:encrypt', existing, target.constructor);
  };
}

/**
 * Marks a property with a data classification level.
 * Metadata key: 'street:classify'
 */
export function Classify(level: DataClassificationLevel): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key = String(propertyKey);
    const existing: Record<string, DataClassificationLevel> =
      (Reflect.getMetadata('street:classify', target.constructor) as Record<string, DataClassificationLevel> | undefined) ?? {};
    existing[key] = level;
    Reflect.defineMetadata('street:classify', existing, target.constructor);
  };
}

// ---------------------------------------------------------------------------
// Retention Job
// ---------------------------------------------------------------------------

export interface GenericPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface RetentionEntityMeta {
  table: string;
  retentionDays: number;
}

/**
 * Deletes rows older than the specified retention period in batches.
 */
export class RetentionJob {
  private readonly pool: GenericPool;
  private readonly batchSize: number;

  constructor(pool: GenericPool, batchSize = 1_000) {
    this.pool = pool;
    this.batchSize = batchSize;
  }

  async run(entityMeta: RetentionEntityMeta[]): Promise<void> {
    for (const { table, retentionDays } of entityMeta) {
      await this._deleteForTable(table, retentionDays);
    }
  }

  private async _deleteForTable(table: string, retentionDays: number): Promise<void> {
    // Sanitize table name (alphanumeric + underscore only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }

    let deleted = 0;
    do {
      const result = await this.pool.query(
        `DELETE FROM ${table}
         WHERE id IN (
           SELECT id FROM ${table}
           WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
           LIMIT ${this.batchSize}
         )`
      );
      deleted = result.rows.length;
    } while (deleted >= this.batchSize);
  }
}

// ---------------------------------------------------------------------------
// Compliance Reporter
// ---------------------------------------------------------------------------

export interface ComplianceReport {
  field: string;
  entity: string;
  classification?: DataClassificationLevel;
  encrypted: boolean;
  retentionPeriod?: string;
}

export class ComplianceReporter {
  static report(entities: (new () => unknown)[]): ComplianceReport[] {
    const reports: ComplianceReport[] = [];

    for (const EntityClass of entities) {
      const entityName = EntityClass.name;

      const retentionMeta: Record<string, string> =
        (Reflect.getMetadata('street:retention', EntityClass) as Record<string, string> | undefined) ?? {};
      const encryptMeta: string[] =
        (Reflect.getMetadata('street:encrypt', EntityClass) as string[] | undefined) ?? [];
      const classifyMeta: Record<string, DataClassificationLevel> =
        (Reflect.getMetadata('street:classify', EntityClass) as Record<string, DataClassificationLevel> | undefined) ?? {};

      // Collect all annotated fields
      const allFields = new Set<string>([
        ...Object.keys(retentionMeta),
        ...encryptMeta,
        ...Object.keys(classifyMeta),
      ]);

      for (const field of allFields) {
        reports.push({
          field,
          entity: entityName,
          classification: classifyMeta[field],
          encrypted: encryptMeta.includes(field),
          retentionPeriod: retentionMeta[field],
        });
      }
    }

    return reports;
  }
}
