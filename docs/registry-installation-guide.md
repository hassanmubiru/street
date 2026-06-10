---
layout: default
title: "Plugin Registry — Installation Guide"
nav_exclude: true
description: "How to find and install signed plugins from the StreetJS Network Plugin Registry with the street CLI — search, list, and install with integrity verification."
---

# Installation Guide

This guide covers the consumer side of the **Network Plugin Registry**: how to
discover plugins with `street registry search` / `street registry list` and
install them with `street registry install`. Every install performs
**consumer-side integrity verification** before a single byte is written to disk
(Req 4.3).

> See also the [Publishing Guide](./registry-publishing-guide.md) for the author
> side of the flow.

## Pointing at a registry

All read operations (search, list, versions, download, verify) are **public** —
no token is required. Choose the registry with `--registry <url>` or the
`STREET_REGISTRY_URL` environment variable. Defaults to `http://localhost:8787`.

```bash
export STREET_REGISTRY_URL=https://registry.example.com
```

## Discovering plugins

### List

Page through every published plugin (default page size 25, maximum 100):

```bash
street registry list --page 1 --page-size 25
```

### Search

Filter by free-text query, category, and/or tag:

```bash
street registry search widget --category ui --tag widget
```

Both commands print each plugin's name, latest version, description, and its
categories and tags:

```
  Plugins (page 1, 1 of 1)

  acme/widgets                 1.2.0      A widget plugin
                                          categories: [ui, tools] tags: [widget]
```

## Installing a plugin

Install the latest version, or pin a specific one with `name@version`:

```bash
# Latest published version (resolved from version history)
street registry install acme/widgets

# A specific version
street registry install acme/widgets@1.2.0

# Choose where to write it (defaults to plugins/<name>)
street registry install acme/widgets --out ./vendor/acme-widgets
```

On success:

```
[street] Installed acme/widgets@1.2.0 (signature + checksum verified)
[street]   location: /path/to/project/plugins/acme__widgets
```

The install directory contains:

- `manifest.json` — the signed manifest (with its `checksum` and `signature`).
- `package.tgz` — the verified plugin tarball.

### What the CLI verifies

The registry returns the package together with its recorded Ed25519 signature so
the consumer can validate integrity independently. Before writing anything, the
CLI checks **all three** of the following — and aborts the install if any fails:

1. **Manifest checksum** matches the manifest's canonical body.
2. **Ed25519 signature** verifies against the recorded publisher public key.
3. **Tarball checksum** — the downloaded bytes hash to the recorded SHA-256.

```
[street] Install aborted: integrity verification failed.
[street]   manifest checksum: ok
[street]   signature:         FAILED
[street]   tarball checksum:  ok
```

A failed verification, an unknown `name@version`, or an unreachable registry all
exit non-zero, so installs are safe to script in CI.

## Loading an installed plugin

Installation places the verified manifest and tarball on disk. To load a plugin
into a running application, register it with the `PluginHost`, which
**re-verifies** the manifest signature at registration time. See the
[plugin system](./plugins.md) and the
[Local Plugin Registry](./plugin-registry.md) for the in-process loading path.
