Summary

The published streetjs@1.0.6 package also references missing observability modules from the root barrel, so the package has another independent set of broken imports beyond the first startup failure.
Repro

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node --input-type=module -e "import('streetjs').catch(err => console.error(err))"

Missing refs observed in the tarball

    dist/observability/logger.js
    dist/observability/health.js
    dist/observability/analytics.js
    dist/observability/grafana-dashboard.js
    dist/observability/prometheus.js
    dist/observability/prometheus-rules.js
    dist/observability/otel.js

Expected result

All files re-exported by the published root barrel should exist in the npm package.

Summary

The published streetjs@1.0.6 root barrel imports several modules that are not present in the npm tarball, so a clean import('streetjs') fails immediately.
Repro

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node --input-type=module -e "import('streetjs').catch(err => console.error(err))"

Actual result

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/streetjs/dist/testing/chaos.js' imported from '.../node_modules/streetjs/dist/index.js'

Missing refs observed in the tarball

    dist/testing/chaos.js
    dist/devx/codemods.js
    dist/devx/playground.js
    dist/diagnostics/reporter.js
    dist/diagnostics/route-profiler.js
    dist/diagnostics/socket-server.js

Expected result

import { streetApp } from 'streetjs' should work from a clean npm install.

Consolidated summary for triage:

    streetjs@1.0.6 fails on a clean import('streetjs') because the published package is missing dist/testing/chaos.js.
    Additional missing runtime files are also present in the tarball:
        dist/diagnostics/reporter.js
        dist/observability/logger.js
        dist/observability/health.js
        dist/observability/analytics.js
        dist/observability/grafana-dashboard.js
        dist/observability/prometheus.js
        dist/observability/prometheus-rules.js
        dist/observability/otel.js
Clean repro:

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node --input-type=module -e "import('streetjs').catch(err => console.error(err))"

The first failure is ERR_MODULE_NOT_FOUND for dist/testing/chaos.js imported from dist/index.js.

Patch checklist for the npm publish failure:

    Fix the root barrel (dist/index.js) so it only re-exports files that are actually published.
    Add the missing runtime files to the npm package or remove their exports if they are not meant to ship:
        dist/testing/chaos.js
        dist/diagnostics/reporter.js
        dist/diagnostics/route-profiler.js
        dist/diagnostics/socket-server.js
        dist/observability/logger.js
        dist/observability/health.js
        dist/observability/analytics.js
        dist/observability/grafana-dashboard.js
        dist/observability/prometheus.js
        dist/observability/prometheus-rules.js
        dist/observability/otel.js
    Make the npm pack step part of CI and verify the tarball contents before publish.
    Add a clean-install smoke test that runs node --input-type=module -e "import('streetjs')" after npm pack or npm install from the published tarball.
    If these modules are dev-only, move them out of the root export surface so a production install does not import them.

This should close the startup crash and prevent the other missing-file failures from reappearing.

PR-ready fix plan:

    Remove any root exports that point to files not shipped in the npm tarball.
    Add the missing runtime files to the published package, or move those modules out of the public export surface.
    Add a publish verification step that inspects the packed tarball.
    Add a clean-install smoke test: node --input-type=module -e "import('streetjs')".
    Keep the root import path working from a fresh npm install.

Mapped fix plan by source file:

    packages/core/src/index.ts: remove or gate root exports that point at non-published modules.
    packages/core/src/testing/chaos.ts: decide whether this module ships publicly; if yes, include it in the tarball and keep the export, otherwise drop it from the root barrel.
    packages/core/src/diagnostics/reporter.ts: include in publish output or stop re-exporting it.
    packages/core/src/diagnostics/route-profiler.ts: include in publish output or stop re-exporting it.
    packages/core/src/diagnostics/socket-server.ts: include in publish output or stop re-exporting it.
    packages/core/src/observability/logger.ts: include in publish output or stop re-exporting it.
    packages/core/src/observability/health.ts: include in publish output or stop re-exporting it.
    packages/core/src/observability/analytics.ts: include in publish output or stop re-exporting it.
    packages/core/src/http/server.ts and publish config: add a clean-install smoke test that imports streetjs from the packed tarball before release.
    CI / release workflow: verify npm pack contents match the exported surface before publishing.

   Minimal publish patch proposal:

    Tighten the published file list so npm pack only includes files that are actually present and intended for production use.
    Split dev/test-only modules out of the root export surface, or move them to a separate non-root path that is not imported by default.
    Add a prepublish or CI tarball check that fails if any exported module path is missing from the packed package.
    Add a smoke test on the packed tarball:
        npm pack
        install the tarball into a clean temp project
        run node --input-type=module -e "import('streetjs')"
    If the root barrel is meant to stay stable, make dist/index.js a production-safe entrypoint that does not transitively import test/diagnostics helpers that are absent from the npm package.

Summary for maintainers:

A clean install of streetjs@1.0.6 crashes on import because the published package references runtime files that are not present in the npm tarball.

Verified failures:

    dist/testing/chaos.js imported from dist/index.js
    dist/diagnostics/reporter.js imported from dist/router/router.js
    dist/observability/logger.js
    dist/observability/health.js
    dist/observability/analytics.js
    dist/observability/grafana-dashboard.js
    dist/observability/prometheus.js
    dist/observability/prometheus-rules.js
    dist/observability/otel.js

Repro:

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node --input-type=module -e "import('streetjs').catch(err => console.error(err))"

Recommended fix:

    make the root barrel production-safe,
    either publish every referenced runtime module or remove them from the default export surface,
    add a tarball integrity check and a clean-install smoke test before publish.
Summary

The published streetjs@1.0.6 package is missing dist/diagnostics/reporter.js, which is imported by dist/router/router.js and also re-exported by dist/index.js.
Repro

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node -e "import('streetjs').catch(err => console.error(err))"

Actual result

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/streetjs/dist/diagnostics/reporter.js' imported from '.../node_modules/streetjs/dist/router/router.js'

Expected result

The published package should include every file referenced by its ESM imports and root exports.

Minimal repro from a clean install:

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
cat > repro.mjs <<'EOF2'
import 'reflect-metadata';
import { streetApp } from 'streetjs';
const app = streetApp({ port: 3210 });
await app.listen();
EOF2
node repro.mjs

This fails before the app starts with ERR_MODULE_NOT_FOUND for dist/testing/chaos.js imported from dist/index.js. I also observed a second missing file, dist/diagnostics/reporter.js, when importing deeper modules.

Summary

Installing streetjs@1.0.6 from npm and importing the package root crashes before the app starts. The published package references a file that is not included in the npm tarball.
Repro

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
cat > repro.mjs <<'EOF2'
import 'reflect-metadata';
import { streetApp } from 'streetjs';
const app = streetApp({ port: 3210 });
await app.listen();
EOF2
node repro.mjs

Actual result

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/.../node_modules/streetjs/dist/testing/chaos.js' imported from '/tmp/.../node_modules/streetjs/dist/index.js'

Expected result

import { streetApp } from 'streetjs' should start the app without a module resolution error.
Notes

I also encountered a second missing runtime file in the published package, dist/diagnostics/reporter.js, when importing deeper modules. The root crash happens first and blocks any app startup.

Environment: Linux, Node 22.22.1, npm install from the npm registry.

Summary

The published streetjs@1.0.6 package is missing dist/diagnostics/reporter.js, which is imported by dist/router/router.js and also re-exported by dist/index.js.
Repro

mkdir /tmp/streetjs-repro
cd /tmp/streetjs-repro
npm init -y
npm install streetjs reflect-metadata
node -e "import('streetjs').catch(err => console.error(err))"

Actual result

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/streetjs/dist/diagnostics/reporter.js' imported from '.../node_modules/streetjs/dist/router/router.js'

Expected result

The published package should include every file referenced by its ESM imports and root exports.