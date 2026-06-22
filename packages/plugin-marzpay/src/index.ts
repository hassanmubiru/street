// packages/plugin-marzpay/src/index.ts
// Official StreetJS plugin: MarzPay payments.
//
// Dependency-free: request construction is pure and offline-verifiable; the
// network send uses node:https. Mirrors the audited @streetjs/plugin-paypal
// design. The concrete MarzPay API surface (base address, auth scheme, endpoint
// paths, webhook scheme) is bound from the verify-don't-invent Research_Artifact
// at docs/integrations/marzpay-research.md in later tasks (MarzPaySpec seam).
//
// NOTE: This is the package skeleton (Task 2). Configuration validation, the
// MarzPaySpec binding, the pure request builders, the MarzPayClient transport,
// and the MarzPayPlugin lifecycle are implemented in subsequent tasks
// (3.1, 4.1, 5.x, 6.x, 7.x, 8.x).

import type { PluginManifest } from 'streetjs';

/** Manifest name, matching manifest.json so the plugin host verifies on load. */
export const MARZPAY_PLUGIN_NAME = 'street-plugin-marzpay';
export const MARZPAY_PLUGIN_VERSION = '1.0.0';

/**
 * The plugin manifest, mirroring the PayPal convention so the Marketplace_Generator
 * categorizes the plugin under `Payments` and `PluginHost` verifies the signed
 * manifest on load.
 */
export function marzPayPluginManifest(): PluginManifest {
  return {
    name: MARZPAY_PLUGIN_NAME,
    version: MARZPAY_PLUGIN_VERSION,
    capabilities: ['payments', 'marzpay'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}
