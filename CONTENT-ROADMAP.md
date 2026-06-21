# Content Roadmap — StreetJS Phase 17 (Workstream F)

> Tags: **RECOMMENDATION** unless noted. Content must be evidence-based: only
> claim numbers verified in the repo (2 runtime deps, 20+ plugins, native
> drivers, OpenSSF/SBOM/provenance). No fabricated benchmarks or adopters.

Existing: `docs/blog/index.md` lists planned topics — VERIFIED. This roadmap
expands distribution across channels and ties every piece to a real feature.

Themes (priority order): TypeScript · Node.js · APIs · SaaS · Realtime · Authentication.

## Dev.to — 20 article titles
1. Building a TypeScript backend with 2 dependencies
2. A native PostgreSQL driver in pure Node.js: how the wire protocol works
3. Decorator-based controllers without NestJS
4. Dependency injection in TypeScript from scratch
5. JWT + sessions + RBAC in one framework
6. WebSockets with backpressure and heartbeats, the right way
7. Server-Sent Events for live dashboards
8. A PostgreSQL-backed job queue (no Redis)
9. Cron + saga workflows for long-running jobs
10. Auto-generating OpenAPI 3.1 from decorators
11. Memory-safe Node services: bounded everything
12. SCRAM-SHA-256: authenticating to Postgres by hand
13. Self-hosting a full backend for $5/month
14. Signed plugins: an Ed25519 trust model for npm
15. From Express to StreetJS: a migration guide
16. Type-safe request validation with zod
17. Clustering Node with graceful shutdown
18. AES-256-GCM sessions explained
19. Building an AI chat endpoint with streaming
20. Multi-tenant SaaS data isolation patterns

## Hashnode — 15 deep technical articles
1. Architecture of a dependency-light backend framework
2. Implementing the Postgres v3 wire protocol over `node:net`
3. Designing an IoC container with circular-dependency detection
4. The security model: rate limiting, CSRF, CSP, vault
5. OpenAPI generation internals
6. WebSocket server design: caps, heartbeats, auth-on-upgrade
7. The saga engine: orchestrating distributed steps
8. Provider-agnostic AI: chat, embeddings, RAG, tool calling
9. Building a signed plugin host (sandbox + capabilities)
10. Native MongoDB client: BSON + OP_MSG + SCRAM
11. Full-text search without Elasticsearch (and with it)
12. Observability: OpenTelemetry wiring in core
13. Zero-downtime deploys with the cluster coordinator
14. Supply-chain hardening: SBOM, provenance, OpenSSF
15. Benchmarking methodology (only publish measured results)

## LinkedIn — 30 founder posts (weekly cadence themes)
Build-in-public progress · why dependency minimalism · cost-of-ownership vs
managed services · security posture milestones · plugin ecosystem growth ·
contributor spotlights · release notes in plain language · lessons from
implementing protocols · "framework vs ecosystem" strategy · hiring/community
calls. (30 prompts derived from real release + repo events.)

## X / Twitter — 50 launch/growth posts
Release threads (per `v*.*.*` tag), feature micro-demos (GIF of `street create`),
plugin announcements (1 per official plugin = 20), comparison one-liners (vs
Express/Nest/Fastify), security signals, showcase reveals, tips, polls. Tie each
to a canonical docs URL for SEO referral.

## YouTube — 20 tutorial videos
create→deploy in 10 min · auth service · realtime chat · SaaS starter · AI chat ·
native Postgres driver deep-dive · plugin authoring · migrations · testing ·
observability · Docker deploy · K8s deploy · OpenAPI · jobs/cron · DI · WebSockets
· file uploads (S3/R2) · search · multi-tenant · "Express→StreetJS" migration.

## Distribution rules
- Every asset links to a canonical docs page (drives indexed referral traffic).
- Repurpose 1 deep article → 1 video → 5 social posts (atomize).
- Gate any number behind "MEASURED" — never estimate performance publicly.

**RECOMMENDATION:** start with the **"2 dependencies"** and **"native Postgres
driver"** pieces — they are the most differentiated, defensible, and searchable
angles, and require no new product work.
