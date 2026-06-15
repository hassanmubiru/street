---
layout:    default
title:     "StreetJS vs NestJS"
parent:    "Compare"
nav_order: 3
permalink: /compare/streetjs-vs-nestjs/
description: "StreetJS vs NestJS compared — both offer decorators and dependency injection. StreetJS is far lighter on dependencies with a native PostgreSQL driver; NestJS has a larger ecosystem."
---

# StreetJS vs NestJS

**In one line:** The closest comparison — both use decorators and DI. NestJS is
mature with a huge ecosystem (and many dependencies); StreetJS offers similar
ergonomics with a dramatically smaller dependency footprint and a native database
driver.

---

## At a glance

| | StreetJS | NestJS |
|---|---|---|
| Programming model | Decorators + DI | Decorators + DI (modules/providers) |
| Underlying HTTP | Node core | Express or Fastify adapter |
| Database | Native PG driver + own ORM | TypeORM/Prisma/Mongoose (separate) |
| Auth / RBAC / MFA | Built in | `@nestjs/passport`, guards, + libs |
| WebSockets | Built in + channels | `@nestjs/websockets` + adapter |
| Dependencies | Dependency-light | Large transitive tree |
| Learning curve | Controllers/services/DI | Modules/providers/decorators (steeper) |
| Ecosystem & community | Smaller / younger | Large, mature, well-documented |

---

## Where NestJS wins

- **Ecosystem & docs:** extensive official modules, a large community, abundant
  tutorials, and a deep hiring pool.
- **Maturity:** years of production use across large organizations.
- **Module system:** a formalized module/provider architecture some large teams
  prefer for boundaries.

## Where StreetJS wins

- **Dependency footprint:** StreetJS core is dependency-light; NestJS pulls a
  large transitive tree (plus your chosen ORM/HTTP adapter).
- **Native database driver:** PostgreSQL over the wire with no `pg`/ORM stack
  required (though `@streetjs/orm` is available).
- **Cohesion without adapters:** HTTP, WS, auth, and validation are first-party,
  not adapter-bridged.
- **Lower ceremony:** controllers + services + container, without a separate
  module graph to maintain.

## Honest tradeoffs

NestJS is the more established choice with a far larger ecosystem and community.
If those matter most, choose NestJS. If you want similar decorator/DI ergonomics
with a much smaller dependency surface and an integrated database/realtime/auth
stack, StreetJS is a strong alternative.

---

## Migrating from NestJS

Controllers, providers (services), and guards map closely to StreetJS
controllers, injectables, and middleware. See the
[NestJS → StreetJS migration guide](/migration-from-nestjs/).

```typescript
// NestJS                          // StreetJS
@Controller('users')              @Controller('/users')
export class UsersController {     export class UsersController {
  constructor(private s: Svc) {}     constructor(private s: Svc) {}
  @Get(':id')                        @Get('/:id')
  get(@Param('id') id: string) {}    async get(ctx: StreetContext) {}
}                                  }
```

## FAQ

**Is StreetJS a NestJS clone?**
No. The decorator/DI ergonomics are similar, but StreetJS runs on Node core
(no Express/Fastify adapter), ships a native database driver, and keeps the
dependency tree small.

**Can I use TypeORM/Prisma with StreetJS?**
You can use external libraries, but StreetJS provides its own native driver and
`@streetjs/orm`, so you usually don't need them.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Is StreetJS a NestJS clone?", "acceptedAnswer": {"@type": "Answer", "text": "No. The decorator and DI ergonomics are similar, but StreetJS runs on Node core without an Express/Fastify adapter, ships a native PostgreSQL driver, and keeps a much smaller dependency tree."}},
    {"@type": "Question", "name": "Can I use TypeORM or Prisma with StreetJS?", "acceptedAnswer": {"@type": "Answer", "text": "You can use external libraries, but StreetJS provides a native database driver and @streetjs/orm, so they are usually unnecessary."}}
  ]
}
</script>
