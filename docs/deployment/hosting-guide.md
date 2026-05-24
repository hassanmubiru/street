---
layout:    default
title:     "GitHub Pages & npm Publishing"
parent:    "Deployment"
nav_order: 2
permalink: /deployment/hosting-guide/
---

# Hosting Guide: GitHub Pages + npm

Complete step-by-step instructions for publishing the street framework as an npm package and hosting its documentation on GitHub Pages.

---

## Part 1 — Publish to npm

### Prerequisites

- An npm account at [npmjs.com](https://www.npmjs.com)
- npm CLI ≥ 9 (`npm --version`)
- A GitHub repository for the project

---

### Step 1: Choose your package name

The `package.json` uses `@streetjs/core` (a scoped package). Scoped packages require either:
- A free npm organisation (`@streetjs`) — create at npmjs.com/org/create
- Or use an unscoped name like `street-framework`

Check availability:

```bash
npm view @streetjs/core          # If this 404s, the name is free
npm view street-framework        # Check unscoped alternative
```

To change the name, edit `package.json`:

```json
{ "name": "@your-org/street" }
```

---

### Step 2: Create an npm access token

1. Log in at [npmjs.com](https://www.npmjs.com)
2. Click your avatar → **Access Tokens**
3. Click **Generate New Token** → **Granular Access Token**
4. Set:
   - **Token name**: `github-actions-street`
   - **Expiration**: 365 days (or no expiry)
   - **Packages and scopes**: Read and write
   - **Selected packages**: `@streetjs/core` (or your chosen name)
5. Copy the token — you will not see it again

---

### Step 3: Add the token to GitHub Secrets

In your GitHub repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `NPM_TOKEN`
4. Value: paste the npm token
5. Click **Add secret**

Also add the CI session key secret:

```bash
# Generate a SESSION_KEY for CI
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Name: `CI_SESSION_KEY`
- Value: the 64-character hex string

---

### Step 4: First manual publish (one-time setup)

Before the automated workflow runs, publish once manually to create the package on npm and set access to public:

```bash
# Log in to npm
npm login
# Enter your username, password, and OTP (if 2FA enabled)

# Build the library
npm run build

# Publish (first time, sets access=public)
npm publish --access public
```

If you used a scoped name and it fails with "402 Payment Required", add `--access public` — scoped packages are private by default.

---

### Step 5: Verify the publish

```bash
npm view @streetjs/core
# Should show version, description, exports etc.

# Test install in a temporary directory
mkdir /tmp/test-street && cd /tmp/test-street
npm init -y
npm install @streetjs/core
node -e "import('@streetjs/core').then(m => console.log(Object.keys(m)))"
```

---

### Step 6: Automated releases via git tags

Every push of a `v*.*.*` tag triggers the `npm-publish.yml` workflow:

```bash
# Bump version (e.g., patch: 1.0.0 → 1.0.1)
npm run version:patch

# Commit and tag
git add package.json CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1

# Push — this triggers the npm-publish workflow
git push origin main --tags
```

The workflow will:
1. Run the full test suite against PostgreSQL
2. Build the library with `tsconfig.lib.json`
3. Run `npm publish --provenance` (npm provenance links the package to the exact commit)
4. Create a GitHub Release with the changelog section for that version

---

### Step 7: Verify automated publish

1. Go to **Actions** tab in GitHub → select the `Publish to npm` workflow run
2. Watch each step complete
3. Check https://www.npmjs.com/package/@streetjs/core for the new version

---

### What gets published

The `files` field in `package.json` controls what is included:

```
dist/src/**/*.js        ← Compiled JavaScript
dist/src/**/*.d.ts      ← TypeScript declarations
dist/src/**/*.js.map    ← Source maps
migrations/             ← SQL migration files
README.md
LICENSE
CHANGELOG.md
```

What is **excluded** (via `.npmignore`):
- `src/` — TypeScript source (consumers use compiled `dist/`)
- `tests/` — test files
- `dist/tests/` — compiled tests
- `dist/src/main.*` — app entry point (not a library export)
- `dist/src/controllers/`, `dist/src/services/`, `dist/src/domain/` — example app code
- `Dockerfile`, `.github/`, `docs/` — dev tooling

---

## Part 2 — Host docs on GitHub Pages

### Step 1: Enable GitHub Pages in repository settings

1. Go to your repository → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Leave everything else as default
4. Click **Save**

---

### Step 2: Configure your site URL

Edit `docs/_config.yml` and replace the placeholder URLs:

```yaml
url:     "https://YOUR-USERNAME.github.io"
baseurl: "/street"    # Must match your repository name exactly
```

Also update the GitHub edit link:

```yaml
gh_edit_repository: "https://github.com/YOUR-USERNAME/street"
```

And the aux links:

```yaml
aux_links:
  "GitHub":
    - "https://github.com/YOUR-USERNAME/street"
  "npm":
    - "https://www.npmjs.com/package/@YOUR-SCOPE/street"
```

---

### Step 3: Install Ruby dependencies locally (for preview)

```bash
cd docs
gem install bundler
bundle install
```

Preview the site locally:

```bash
bundle exec jekyll serve --livereload
# Open http://localhost:4000/street in your browser
```

The sidebar should show the full navigation tree:
- Home
- Getting Started
  - Installation
  - Project Structure
  - First Server
  - Configuration
- Core
  - Dependency Injection
  - Routing
  - Controllers
  - Middleware & Validation
- Database
- Security
- Realtime
- Storage
- Performance
- CLI
- Deployment
- Testing
- Examples

---

### Step 4: Push to deploy

```bash
git add docs/
git commit -m "docs: add Jekyll site with just-the-docs theme"
git push origin main
```

The `docs.yml` workflow triggers automatically. To watch it:

1. Go to **Actions** → **Deploy Documentation**
2. Click the running workflow
3. After it completes, your site is live at: `https://YOUR-USERNAME.github.io/street`

---

### Step 5: Add a custom domain (optional)

To use `docs.streetframework.dev` instead of `github.io`:

1. Add a `CNAME` file to the `docs/` directory:

```bash
echo "docs.streetframework.dev" > docs/CNAME
```

2. Update `_config.yml`:

```yaml
url:     "https://docs.streetframework.dev"
baseurl: ""
```

3. In your DNS provider, add a CNAME record:
   - Host: `docs`
   - Points to: `YOUR-USERNAME.github.io`

4. In GitHub → Settings → Pages → Custom domain: enter `docs.streetframework.dev` and enable **Enforce HTTPS**

---

### Step 6: Adding new documentation pages

1. Create a Markdown file in the appropriate `docs/` subdirectory
2. Add Jekyll front matter at the top:

```markdown
---
layout:    default
title:     "My New Page"
parent:    "Getting Started"
nav_order: 5
---

# My New Page

Content goes here.
```

3. Commit and push — the site redeploys automatically

---

## Part 3 — Keep both in sync

### Updating docs with every release

Extend the `npm-publish.yml` workflow to trigger a docs rebuild after a successful publish:

```yaml
# Add to npm-publish.yml after the publish-npm job:
  update-docs:
    name: Refresh docs site
    needs: publish-npm
    runs-on: ubuntu-latest
    permissions:
      actions: write
    steps:
      - name: Trigger docs deploy
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.actions.createWorkflowDispatch({
              owner:   context.repo.owner,
              repo:    context.repo.repo,
              workflow_id: 'docs.yml',
              ref:     'main',
            });
```

### Badges in README

After publishing, add live badges to `README.md`:

```markdown
[![npm version](https://img.shields.io/npm/v/@streetjs/core.svg)](https://www.npmjs.com/package/@streetjs/core)
[![npm downloads](https://img.shields.io/npm/dm/@streetjs/core.svg)](https://www.npmjs.com/package/@streetjs/core)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://your-org.github.io/street)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

---

## Checklist

### Before first npm publish

- [ ] `npm view @streetjs/core` returns 404 (name is available)
- [ ] `NPM_TOKEN` secret added to GitHub repository
- [ ] `CI_SESSION_KEY` secret added to GitHub repository
- [ ] `package.json` `name`, `homepage`, `repository.url` updated to real values
- [ ] `npm run build` succeeds locally
- [ ] `npm pack --dry-run` shows only intended files

### Before enabling GitHub Pages

- [ ] `docs/_config.yml` `url` and `baseurl` set to real values
- [ ] `docs/_config.yml` `gh_edit_repository` points to real repository
- [ ] GitHub Pages source set to **GitHub Actions** in repository Settings
- [ ] `bundle exec jekyll serve` previews correctly locally

### After go-live

- [ ] `https://YOUR-USERNAME.github.io/street` loads and all nav links work
- [ ] `https://www.npmjs.com/package/@streetjs/core` shows correct metadata
- [ ] `npm install @streetjs/core` in a test project resolves correctly
- [ ] TypeScript `import { streetApp } from '@streetjs/core'` resolves types correctly
