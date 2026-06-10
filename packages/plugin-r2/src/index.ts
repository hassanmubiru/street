// @streetjs/plugin-r2
// Official Street Framework plugin for Cloudflare R2 object storage.
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. R2 is S3-compatible, so request signing reuses the framework's
// verified AWS SigV4 signer (service `s3`, region `auto`) and is deterministic
// and offline-verifiable.

import { R2Plugin, r2PluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  R2Plugin,
  R2Client,
  r2PluginManifest,
  validateR2Config,
  R2_PLUGIN_NAME,
  R2_PLUGIN_VERSION,
} from 'streetjs';
export type { R2PluginConfig } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = r2PluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default R2Plugin;
