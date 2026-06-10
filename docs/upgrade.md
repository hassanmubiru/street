---
layout: default
title: "`street upgrade` — codemods"
nav_exclude: true
description: "Upgrade StreetJS — codemods and the street upgrade command to move between framework versions."
---

# `street upgrade` — codemods

`street upgrade` applies migration **codemods** to your TypeScript sources so you
can adopt API changes mechanically instead of by hand. It is **dry-run by
default** (it shows what would change) and only writes when you pass `--write`.

The codemod engine lives in `streetjs` (`applyCodemods`, `listCodemods`),
so codemods are unit-testable and reusable outside the CLI.

## Usage

```bash
street upgrade --list                 # show available codemods
street upgrade [path]                 # dry-run over <path> (default: src)
street upgrade [path] --write         # apply changes to disk
street upgrade [path] --codemod <id>  # run a single codemod
street upgrade --from <v> --to <v>    # report breaking changes for a range
```

`node_modules`, `dist`, `.git`, `build`, and `coverage` are always skipped, and
`.d.ts` files are ignored. A path that points at a single file upgrades just
that file.

## Breaking-change report

Before touching any files, `street upgrade` resolves the **installed** and
**target** Framework versions and reports the breaking changes crossed by the
upgrade. The installed version is read from `--from`, else detected from the
project's installed `streetjs` (falling back to the deprecated `@streetjs/core`).
The target is read from `--to`, else defaults to the latest version the CLI
bundles.

For each breaking change the report records its **area** (routing, middleware,
or plugin-api), the **recommendation** (the required source change), and whether
an **automated codemod** is available to apply it:

```
$ street upgrade --from 0.9.0 --to 1.0.0 src

  street upgrade — breaking changes
  installed:      0.9.0
  target:         1.0.0
  1 breaking change detected:

  • [plugin-api] The `RabbitMQTransport` plugin-API alias was renamed to the canonical `RabbitMqTransport`.
      recommendation: Rename all references to `RabbitMQTransport` to `RabbitMqTransport`. Run codemod "rename-rabbitmq-transport" to apply this automatically.
      codemod: rename-rabbitmq-transport
```

If a version is explicitly requested with `--from`/`--to` but cannot be
resolved, the upgrade **halts before any file is changed** and reports which
version failed (non-zero exit). When no version information is available and
none is requested, the report is skipped and the codemod pass proceeds.

### Example

```
$ street upgrade src
  would update: src/events.ts (2 changes)

  street upgrade — summary
  mode:           dry-run (use --write to apply)
  files scanned:  37
  files changed:  1
  total changes:  2
    - rename-rabbitmq-transport: 2
```

Re-running after `--write` reports `total changes: 0` — codemods are idempotent.

## Codemods by area

Codemods are grouped by the breaking-change **area** they migrate. Every codemod
is a pure source→source transform: it renames **whole-word** identifiers only
(so `RabbitMQTransport` is rewritten while a longer identifier like
`RabbitMQTransportFactory` is left untouched), is **idempotent** (re-running it
is a byte-for-byte no-op), and is **safe on failure** (an unparseable or
conflicting file is left unchanged and the reason reported).

| id | area | description |
| --- | --- | --- |
| `rename-rabbitmq-transport` | plugin-api | Rename the deprecated `RabbitMQTransport` alias to the canonical `RabbitMqTransport`. |
| `rename-router-context` | routing | Rename the routing handler context type `RouterContext` to `RouteContext`. |
| `rename-route-handler-type` | routing | Rename the deprecated `RouteHandlerFn` type alias to `RouteHandler`. |
| `rename-middleware-next` | middleware | Rename the `MiddlewareNext` callback type to the canonical `NextFunction`. |
| `rename-use-middleware` | middleware | Rename the deprecated `app.useMiddleware` registration method to `app.use`. |
| `rename-plugin-register` | plugin-api | Rename the deprecated `registerPlugin` host method to `usePlugin`. |
| `rename-plugin-context` | plugin-api | Rename the `PluginContext` type to the canonical `PluginHost`. |

The change count is reported per file and per codemod.

## Programmatic API

```ts
import { applyCodemods, listCodemods } from 'streetjs';

const { code, totalChanges, perCodemod } = applyCodemods(source);          // all built-ins
const onlyOne = applyCodemods(source, ['rename-rabbitmq-transport']);       // selected
```

## Migration examples

The codemods are exercised against a set of real **migration examples** — one or
more before/after source pairs per codemod, covering all three areas — exported
from `streetjs` as `MIGRATION_EXAMPLES`. The codemod test suite applies each
codemod to its `before` example and asserts the result equals the `after`
example exactly, and that re-application is a no-op.

## Verification

The codemod test suite is run against the migration examples through the
zero-dependency `CommandRunner`, which records the run in the machine-readable
`upgrade.codemods` **Verification Artifact** under
`verification-artifacts/upgrade/`. This is wired as the `verify:codemods` script
and uploaded as retained evidence by the `Upgrade Codemods Verification` CI job.

```bash
# Run the codemod suite and emit verification-artifacts/upgrade/upgrade.codemods.artifact.json
npm run verify:codemods
```

The suite covers:

- Engine: `packages/core/src/tests/codemods.test.ts` — word-boundary renaming,
  change counting, the built-in rename, area codemods, selection, unknown-id
  rejection, parse/conflict safety.
- Examples: `packages/core/src/tests/codemods-migration-examples.test.ts` —
  before→after correctness and idempotence for every migration example.
- Properties: codemod idempotence, codemod safe-on-failure, version resolution,
  and breaking-change analysis (`*-pbt.test.ts`).
- CLI: `packages/cli/src/tests/upgrade.test.ts` — `--list`, dry-run (no mutation,
  `node_modules` skipped), `--write` (applies to disk), and idempotent re-run.
