#!/usr/bin/env bash
# Seeds 25 good-first-issues for StreetJS Phase 18 ecosystem growth.
# Each maps to a real gap from ECOSYSTEM-PLUGINS-AUDIT.md / CLI-EVOLUTION.md /
# PHASE-18-EXECUTION-PLAN.md. Idempotent guard: skips a title that already exists.
set -euo pipefail
REPO="hassanmubiru/StreetJS"

existing="$(gh issue list --repo "$REPO" --state all --limit 500 --json title -q '.[].title')"

create() {
  local title="$1" labels="$2" body="$3"
  if grep -Fxq "$title" <<<"$existing"; then echo "skip (exists): $title"; return; fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body "$body" >/dev/null \
    && echo "created: $title" || echo "FAILED: $title"
}

M="good first issue,help wanted"

create "CLI: add \`street generate module\`" "$M,cli" \
"Add a \`module\` subcommand to \`street generate\` that scaffolds a controller + service + repository as a cohesive module (parity with Nest/Angular). Mirror the existing generate subcommands in \`packages/cli/src/commands/generate.ts\`.

**Acceptance:** \`street generate module billing\` creates the three files wired together; unit test added to \`create-templates\`/\`generate\` test (already in the coverage list); coverage stays ≥85% branches.
**Mentorship:** available — ping a maintainer."

create "CLI: add \`street generate guard\`" "$M,cli" \
"Scaffold an auth/cross-cutting guard via \`street generate guard <name>\`, following the patterns in \`packages/cli/src/commands/generate.ts\`.

**Acceptance:** generates a guard file + test; coverage ≥85%."

create "CLI: add \`street plugin search <query>\`" "$M,cli,ecosystem" \
"Add \`plugin search\` to \`packages/cli/src/commands/plugin.ts\`, querying the registry client used by \`registry.ts\`.

**Acceptance:** \`street plugin search redis\` lists matching official plugins; unit test; coverage ≥85%.
**Mentorship:** available."

create "CLI: add \`street plugin info <name>\`" "$M,cli,ecosystem" \
"Add \`plugin info\` showing a plugin's certification level, version and scorecard (see \`docs/ecosystem/plugin-certification.md\`).

**Acceptance:** prints metadata for an installed/known plugin; unit test."

create "Plugin: \`@streetjs/plugin-oauth\` GitHub provider preset" "$M,ecosystem" \
"Add a GitHub OAuth preset on top of core OAuth2/OIDC. Dependency-free HTTPS client, signed manifest, \`PluginModule\` SDK shape (mirror an existing \`packages/plugin-*\`).

**Acceptance:** authorize + token + userinfo flow; README with logo; example; test.
**Mentorship:** available."

create "Plugin: \`@streetjs/plugin-oauth\` Google provider preset" "$M,ecosystem" \
"Google OAuth preset (see the GitHub preset issue). Dependency-free, signed.
**Mentorship:** available."

create "Plugin: \`@streetjs/plugin-oauth\` Microsoft provider preset" "$M,ecosystem" \
"Microsoft/Entra OAuth preset. Dependency-free, signed."

create "Plugin: \`@streetjs/plugin-oauth\` LinkedIn provider preset" "$M,ecosystem" \
"LinkedIn OAuth preset. Dependency-free, signed."

create "Plugin: \`@streetjs/plugin-discord\` (OAuth + webhook)" "$M,ecosystem" \
"Discord plugin: OAuth login + webhook/bot message send. Dependency-free HTTPS client, signed manifest.
**Mentorship:** available."

create "Plugin: \`@streetjs/plugin-telegram\` (bot API)" "$M,ecosystem" \
"Telegram bot-API plugin for notifications/ops. Dependency-free HTTPS client, signed manifest."

create "Plugin: \`@streetjs/plugin-resend\` (transactional email)" "$M,ecosystem" \
"Resend email plugin (SendGrid alternative). Dependency-free HTTPS client, signed manifest."

create "Plugin: \`@streetjs/plugin-algolia\` (hosted search)" "$M,ecosystem" \
"Algolia search plugin as a hosted alternative to the self-hosted Meili/Elastic adapters in \`@streetjs/search\`."

create "Marketplace: per-category landing SEO copy" "$M,docs,ecosystem" \
"The generator (\`scripts/gen-plugins-data.mjs\`) emits category pages at \`/plugins/category/<slug>/\`. Add a short intro paragraph per category for SEO.

**Acceptance:** each category page has 1–2 sentences of unique copy; no layout regressions."

create "Marketplace: contributors wall on /community/" "$M,docs" \
"Generate a static contributors list (from git history or all-contributors) and render it on \`/community/\`. Must be GitHub-Pages-safe (static JSON, no server)."

create "Docs: \`street generate plugin\` scaffold" "$M,cli,ecosystem" \
"Add \`street generate plugin <name>\` that emits a buildable \`@streetjs/plugin-*\` package (signed manifest, \`PluginModule\` subclass, README with logo, example, test) passing the Verified-tier checklist.

**Acceptance:** generated package builds; unit test; docs in CLI reference.
**Mentorship:** available (high-impact)."

create "Showcase: write-up for the REST API example (01-rest-api)" "$M,docs" \
"Turn \`examples/01-rest-api\` into a guided showcase page with 'what you'll learn' and a difficulty badge. Link from /showcase/."

create "Showcase: write-up for the realtime chat example (04-realtime-chat)" "$M,docs" \
"Guided showcase page for \`examples/04-realtime-chat\`. Link from /showcase/ and /realtime/."

create "Showcase: write-up for the multiplayer example (06-multiplayer)" "$M,docs" \
"Guided showcase page for \`examples/06-multiplayer\`."

create "Tutorial: Todo API in 60 seconds" "$M,docs" \
"Beginner tutorial building a Todo API with \`street create\` + generators. Maps to the beginner showcase tier.
**Mentorship:** available."

create "Docs: Express → StreetJS migration sample" "$M,docs" \
"A worked migration example (small Express app → StreetJS), complementing \`/migration-from-express/\`."

create "Docs: search adapter how-to (Meili/Elastic)" "$M,docs,ecosystem" \
"How-to for \`@streetjs/search\` with the Meilisearch and Elasticsearch adapters (already shipped in the package)."

create "CLI: \`street generate plugin\` template test" "$M,cli" \
"Add an integration test that scaffolds a plugin via \`street generate plugin\` and asserts it builds. Add to the explicit test list in \`packages/cli/package.json\`."

create "Docs: OpenTelemetry quickstart" "$M,docs" \
"Quickstart for the core observability/OpenTelemetry wiring (\`packages/core/src/observability/otel.ts\`)."

create "Docs: Kubernetes deploy walkthrough" "$M,docs" \
"Walkthrough using the existing \`docs/deployment-manifests.md\` to deploy StreetJS to Kubernetes."

create "Docs/a11y: pass on docs components" "$M,docs" \
"Audit the custom docs components (cards, callouts, marketplace) for color-contrast and keyboard navigation; fix any AA gaps."

echo "done"
