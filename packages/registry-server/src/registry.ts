// @streetjs/registry-server — the registry service (framework-agnostic core).
//
// This is the transport-independent heart of the registry. The HTTP layer
// (server.ts) is a thin adapter over these methods. Every method returns either
// a success value or a `RegistryError`, never throws on expected rejections.
//
// PUBLISH PIPELINE (Req 4.1/4.2/4.5/4.9/4.10), in order:
//   1. authenticate bearer token           → UNAUTHENTICATED
//   2. validate manifest metadata          → INVALID_MANIFEST (field-specific)
//   3. authorize publisher for namespace   → UNAUTHORIZED
//   4. reject duplicate name@version       → DUPLICATE
//   5. verify Ed25519 signature + checksum → INTEGRITY_FAILED
//   6. store (signed manifest + public key + tarball + indexed metadata)
//
// Metadata is validated before authorization because authorization is keyed on
// the manifest's `name` namespace, which must first be known to be well-formed.
// On ANY rejection the store is left untouched, so previously published valid
// versions are preserved (Req 4.4/4.10).

import { createHash, createPublicKey } from 'node:crypto';
import { verifyManifest, manifestChecksum, normalizePageSize } from 'streetjs';
import { PublisherDirectory } from './auth.js';
import { RegistryStore, type StoredVersion } from './store.js';
import { validateManifestMetadata, asManifest } from './validation.js';
import type {
  ListQuery,
  PackageWithSignature,
  Paginated,
  PluginSummary,
  PluginVersion,
  PublishRequest,
  PublishResponse,
  RegistryError,
  SearchQuery,
  VerifyResponse,
} from './types.js';

/** A result that is either a value or a structured registry error. */
export type Result<T> = T | RegistryError;

/** True iff a result is a {@link RegistryError}. */
export function isRegistryError(value: unknown): value is RegistryError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    'message' in value
  );
}

export interface RegistryServiceOptions {
  publishers?: PublisherDirectory;
  store?: RegistryStore;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => Date;
}

/** Optional per-publish metadata not carried inside the manifest. */
export interface PublishMeta {
  categories?: string[];
  tags?: string[];
  description?: string;
}

export class RegistryService {
  readonly publishers: PublisherDirectory;
  readonly store: RegistryStore;
  private readonly now: () => Date;

  constructor(opts: RegistryServiceOptions = {}) {
    this.publishers = opts.publishers ?? new PublisherDirectory();
    this.store = opts.store ?? new RegistryStore();
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Publish a plugin version. `apiKey` is the raw bearer token presented by the
   * caller. Returns a {@link PublishResponse} on success or a
   * {@link RegistryError} identifying the rejection (Req 4.1/4.2/4.5/4.9/4.10).
   */
  publish(apiKey: string | undefined, req: PublishRequest, meta: PublishMeta = {}): Result<PublishResponse> {
    // 1. Authentication (Req 4.9).
    const publisher = this.publishers.authenticate(apiKey);
    if (!publisher) {
      return { code: 'UNAUTHENTICATED', message: 'A valid publisher bearer token is required to publish' };
    }

    // 2. Manifest metadata validation (Req 4.5/4.10).
    const metadataError = validateManifestMetadata(req?.manifest);
    if (metadataError) return metadataError;
    const manifest = asManifest(req.manifest);

    // 3. Namespace authorization (Req 4.9).
    if (!this.publishers.authorize(publisher, manifest.name)) {
      return {
        code: 'UNAUTHORIZED',
        message: `Publisher "${publisher.id}" is not authorized to publish under "${manifest.name}"`,
        field: 'name',
      };
    }

    // 4. Duplicate name@version rejection (Req 4.10).
    if (this.store.hasVersion(manifest.name, manifest.version)) {
      return {
        code: 'DUPLICATE',
        message: `Version ${manifest.name}@${manifest.version} already exists`,
        field: 'version',
      };
    }

    // 5. Ed25519 signature + checksum integrity (Req 4.2/4.4).
    if (typeof req.publicKeyPem !== 'string' || req.publicKeyPem.trim() === '') {
      return { code: 'INTEGRITY_FAILED', message: 'A publisher Ed25519 public key (PEM) is required', field: 'publicKeyPem' };
    }
    if (typeof req.tarballBase64 !== 'string' || req.tarballBase64.trim() === '') {
      return { code: 'INTEGRITY_FAILED', message: 'A plugin tarball (base64) is required', field: 'tarballBase64' };
    }
    let publicKey;
    try {
      publicKey = createPublicKey(req.publicKeyPem);
    } catch {
      return { code: 'INTEGRITY_FAILED', message: 'Publisher public key PEM is not a valid key', field: 'publicKeyPem' };
    }
    if (!verifyManifest(manifest, publicKey)) {
      return {
        code: 'INTEGRITY_FAILED',
        message: 'Manifest failed Ed25519 signature or checksum verification',
        field: 'signature',
      };
    }

    // 6. Store the fully-validated version (Req 4.3 — keep tarball + signature).
    const tarball = Buffer.from(req.tarballBase64, 'base64');
    const tarballChecksum = createHash('sha256').update(tarball).digest('hex');
    const publishedAt = this.now().toISOString();
    const record: StoredVersion = {
      name: manifest.name,
      version: manifest.version,
      manifest,
      publicKeyPem: req.publicKeyPem,
      tarball,
      tarballChecksum,
      categories: meta.categories ?? [],
      tags: meta.tags ?? [],
      publishedAt,
    };
    this.store.put(record, meta);

    return { name: manifest.name, version: manifest.version, tarballChecksum, publishedAt };
  }

  /** Download a package + its recorded signature for consumer-side verification (Req 4.3). */
  download(name: string, version: string): Result<PackageWithSignature> {
    const v = this.store.get(name, version);
    if (!v) return { code: 'NOT_FOUND', message: `No such version ${name}@${version}` };
    return {
      name: v.name,
      version: v.version,
      manifest: v.manifest,
      publicKeyPem: v.publicKeyPem,
      tarballBase64: v.tarball.toString('base64'),
      signature: v.manifest.signature ?? '',
      tarballChecksum: v.tarballChecksum,
    };
  }

  /** Re-check manifest signature/checksum and tarball integrity on demand (Req 4.1). */
  verify(name: string, version: string): Result<VerifyResponse> {
    const v = this.store.get(name, version);
    if (!v) return { code: 'NOT_FOUND', message: `No such version ${name}@${version}` };

    let manifestValid = false;
    try {
      const publicKey = createPublicKey(v.publicKeyPem);
      manifestValid =
        v.manifest.checksum === manifestChecksum(v.manifest) && verifyManifest(v.manifest, publicKey);
    } catch {
      manifestValid = false;
    }

    const tarballValid = createHash('sha256').update(v.tarball).digest('hex') === v.tarballChecksum;

    return {
      name,
      version,
      manifestValid,
      tarballValid,
      valid: manifestValid && tarballValid,
    };
  }

  /** Paginated list of all plugins (default 25 / max 100, Req 4.6). */
  list(query: ListQuery = {}): Paginated<PluginSummary> {
    return paginate(this.store.summaries(), query.page, query.pageSize);
  }

  /** Search with optional free-text + category + tag filters, paginated (Req 4.6). */
  search(query: SearchQuery = {}): Paginated<PluginSummary> {
    const q = query.q?.trim().toLowerCase();
    const filtered = this.store.summaries().filter((s) => {
      if (q && !(s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false))) {
        return false;
      }
      if (query.category && !s.categories.includes(query.category)) return false;
      if (query.tag && !s.tags.includes(query.tag)) return false;
      return true;
    });
    return paginate(filtered, query.page, query.pageSize);
  }

  /** Version history for a plugin (Req 4.6). */
  versions(name: string): PluginVersion[] {
    return this.store.versions(name);
  }
}

/** Clamp + slice a result set into a single page using core's pagination bounds. */
function paginate<T>(items: T[], page: number | undefined, pageSize: number | undefined): Paginated<T> {
  const size = normalizePageSize(pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const reqPage = page === undefined || !Number.isFinite(page) ? 1 : Math.trunc(page);
  const clampedPage = reqPage < 1 ? 1 : reqPage > totalPages ? totalPages : reqPage;
  const start = (clampedPage - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: clampedPage,
    pageSize: size,
    total,
  };
}
