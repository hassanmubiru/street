---
layout: default
title: "Enterprise Console API"
nav_exclude: true
description: "StreetJS Enterprise Console API — REST endpoints for tenant, policy, compliance, and administrative operations, with a generated OpenAPI specification."
---

# Enterprise Console API

The Enterprise Console API is the REST surface for governing a multi-tenant
StreetJS deployment programmatically: tenant lifecycle, policy management
(RBAC, MFA, retention, classification), compliance (audit export, reporting,
posture), and administrative operations (users, key rotation, secrets).

Exported from `streetjs` as `EnterpriseConsole`, `CONSOLE_ROUTES`, and
`consoleOpenApiSpec`.

- **Machine-readable spec:** [`enterprise-console.openapi.json`](./enterprise-console.openapi.json)
  — generated from the live route table, covering every operation below.

## Request lifecycle

Every operation runs the same lifecycle, enforced uniformly by the console and
never inside an individual handler:

1. **Authenticate** — a valid `Authorization: Bearer <jwt>` token is required.
   A missing or invalid token returns **401** with no state change.
2. **Authorize** — the token's `roles` must include at least one of the
   operation's required roles. Otherwise the console returns **403** with no
   state change.
3. **Validate** — the input is validated. Invalid input returns **400**
   identifying the offending `field`, leaving tenant, policy, compliance, and
   administrative state unchanged.
4. **Perform** — only after the three checks pass does the operation execute.

All operations use the `bearerAuth` security scheme (HTTP bearer, JWT).

### Error response shape

```json
{ "error": "invalid_input", "message": "name is required and must be a non-empty string", "field": "name" }
```

| Status | `error` | Meaning |
| --- | --- | --- |
| `400` | `invalid_input` | Input failed validation; `field` identifies the offending input. |
| `401` | `unauthenticated` | Missing or invalid bearer token. |
| `403` | `unauthorized` | Authenticated, but the principal lacks a required role. |
| `404` | `not_found` | No such operation, or the target resource does not exist. |

## Generating the specification

The OpenAPI 3.1 document is generated from the route table through the
framework's OpenAPI facility:

```ts
import { consoleOpenApiSpec } from 'streetjs';

const spec = consoleOpenApiSpec();      // covers every CONSOLE_ROUTES operation
```

To regenerate the published artifact after changing the route table:

```bash
npm --workspace streetjs run build
node scripts/enterprise/generate-openapi.mjs   # writes docs/enterprise-console.openapi.json
```

The script fails if any registered console operation is missing from the
generated spec, keeping documentation and the route table in lock-step (Req 6.9).

---

## Tenant operations

Tenant lifecycle management. Required roles: `admin` or `tenant:write`.

### `POST /api/admin/tenants` — Create a tenant

Creates a new tenant. Responds **201** with the new tenant id.

```json
{ "name": "acme", "plan": "pro", "connectionString": "postgres://..." }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Non-empty tenant display name. |
| `plan` | string | no | Subscription plan. |
| `connectionString` | string | no | Dedicated database connection string. |

### `PATCH /api/admin/tenants/:id` — Update a tenant

Updates an existing tenant. At least one field must be provided. Responds
**200**; **404** if the tenant does not exist.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no | Non-empty when provided. |
| `plan` | string | no | Subscription plan. |
| `status` | string | no | One of `active`, `suspended`. |

### `POST /api/admin/tenants/:id/suspend` — Suspend a tenant

Suspends a tenant by id. Responds **200** with `{ "id", "status": "suspended" }`;
**404** if the tenant does not exist. Takes no request body.

---

## Policy operations

Policy management. Required roles: `admin` or `policy:write`. Each responds
**200** with `{ "ok": true }`.

### `PUT /api/admin/policies/rbac` — Set the RBAC policy

```json
{ "roles": [{ "role": "admin", "permissions": ["*"] }] }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `roles` | array | yes | Each entry needs a non-empty `role` and a `permissions` string array. |

### `PUT /api/admin/policies/mfa` — Set the MFA policy

```json
{ "required": true, "methods": ["totp", "webauthn"] }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `required` | boolean | yes | Whether MFA is mandatory. |
| `methods` | string[] | no | Allowed MFA methods. |

### `PUT /api/admin/policies/retention` — Set a data-retention policy

```json
{ "entity": "orders", "retentionDays": 30 }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entity` | string | yes | Non-empty entity name. |
| `retentionDays` | integer | yes | Positive integer (days). |

### `PUT /api/admin/policies/classification` — Set a data-classification policy

```json
{ "field": "ssn", "level": "restricted" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `field` | string | yes | Non-empty field name. |
| `level` | string | yes | One of `public`, `internal`, `confidential`, `restricted`. |

---

## Compliance operations

Compliance reporting. Required roles: `admin` or `compliance:read`.

### `GET /api/admin/compliance/audit-export` — Export audit records

Exports audit records over a time window. Responds **200** with
`{ "format", "recordCount" }`.

```json
{ "from": "2024-01-01T00:00:00Z", "to": "2024-02-01T00:00:00Z", "format": "jsonl" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes | ISO-8601 start; must not be after `to`. |
| `to` | string | yes | ISO-8601 end. |
| `format` | string | yes | One of `jsonl`, `csv`. |

### `GET /api/admin/compliance/report` — Generate a compliance report

Generates a compliance report. Takes no input. Responds **200** with
`{ "generatedAt", "entries" }`.

### `GET /api/admin/compliance/posture` — Report security posture

Returns the current security-posture summary. Takes no input. Responds **200**
with a posture object.

---

## Admin operations

Administrative operations. Each requires `admin` or a specific least-privilege
role as noted.

### `POST /api/admin/users` — Manage a user

Required roles: `admin` or `user:write`. Responds **200** with
`{ "userId", "action" }`.

```json
{ "action": "create", "userId": "u9", "roles": ["viewer"] }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of `create`, `update`, `disable`. |
| `userId` | string | yes | Non-empty user id. |
| `roles` | string[] | no | Roles to assign. |

### `POST /api/admin/keys/rotate` — Rotate a key

Required roles: `admin` or `key:rotate`. Responds **200** with
`{ "keyId", "rotatedAt" }`.

```json
{ "keyId": "signing-1" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `keyId` | string | yes | Non-empty id of the signing/encryption key to rotate. |

### `PUT /api/admin/secrets/:name` — Create or update a secret

Required roles: `admin` or `secret:write`. Responds **200** with `{ "name" }`.

```json
{ "value": "s3cr3t" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `value` | string | yes | Non-empty secret material to store. |

---

## Operation summary

| Operation | Method | Path | Required roles |
| --- | --- | --- | --- |
| `createTenant` | POST | `/api/admin/tenants` | `admin`, `tenant:write` |
| `updateTenant` | PATCH | `/api/admin/tenants/:id` | `admin`, `tenant:write` |
| `suspendTenant` | POST | `/api/admin/tenants/:id/suspend` | `admin`, `tenant:write` |
| `setRbacPolicy` | PUT | `/api/admin/policies/rbac` | `admin`, `policy:write` |
| `setMfaPolicy` | PUT | `/api/admin/policies/mfa` | `admin`, `policy:write` |
| `setRetentionPolicy` | PUT | `/api/admin/policies/retention` | `admin`, `policy:write` |
| `setClassificationPolicy` | PUT | `/api/admin/policies/classification` | `admin`, `policy:write` |
| `exportAudit` | GET | `/api/admin/compliance/audit-export` | `admin`, `compliance:read` |
| `generateComplianceReport` | GET | `/api/admin/compliance/report` | `admin`, `compliance:read` |
| `securityPosture` | GET | `/api/admin/compliance/posture` | `admin`, `compliance:read` |
| `manageUser` | POST | `/api/admin/users` | `admin`, `user:write` |
| `rotateKey` | POST | `/api/admin/keys/rotate` | `admin`, `key:rotate` |
| `manageSecret` | PUT | `/api/admin/secrets/:name` | `admin`, `secret:write` |

All thirteen operations appear in the generated
[OpenAPI specification](./enterprise-console.openapi.json).
