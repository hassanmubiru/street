export type CloudPlatform = 'kubernetes' | 'cloudrun' | 'ecs' | 'nomad';
/**
 * The seven supported Deployment Targets of the Cloud Deployment Verifier
 * (Requirement 2.1). Each target has its own per-target deliverable bundle,
 * produced by {@link generateTargetAssets}.
 */
export type DeploymentTarget = 'kubernetes' | 'cloudrun' | 'ecs' | 'lambda' | 'azure-functions' | 'gcf' | 'cloudflare-workers';
export interface DeployConfig {
    name: string;
    image: string;
    port: number;
    replicas?: number;
    cpu?: string;
    memory?: string;
    env?: Record<string, string>;
}
/**
 * Generate a deployment manifest YAML/JSON string for the given cloud platform.
 */
export declare function generateManifest(platform: CloudPlatform, config: DeployConfig): string;
export interface ManifestValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Structurally validate a generated deployment manifest for a platform: it must
 * declare the right resource kind(s), reference a container image and port, and
 * wire the liveness/readiness health probes (or the ECS health check). This
 * verifies the generated artifact offline — it does NOT verify a live deployment.
 */
export declare function validateDeploymentManifest(platform: CloudPlatform, manifest: string): ManifestValidationResult;
/**
 * Generate the per-target deliverable bundle for a {@link DeploymentTarget}
 * (Requirements 2.1, 2.2). Returns a map of relative file path → file content
 * so callers can write or structurally verify the assets offline.
 *
 * Kubernetes is fully realized here: split production manifests
 * (Deployment/Service/HPA), the Helm chart under `deploy/helm/street/`, and the
 * standalone HPA autoscaling example. The Cloud Run and ECS bundles reuse the
 * existing offline generators. The serverless targets (lambda, azure-functions,
 * gcf, cloudflare-workers) carry a baseline deploy workflow here; their handler
 * adapters and full workflows are filled in by a later task.
 */
export declare function generateTargetAssets(target: DeploymentTarget, cfg: DeployConfig): Record<string, string>;
/**
 * The Street Helm chart deliverable. Templates are values-driven so a single
 * chart serves dev/staging/prod via `values.yaml` overrides. Returns a map of
 * chart file path → content (Requirement 2.2).
 */
export declare function helmChartAssets(): Record<string, string>;
//# sourceMappingURL=deployment.d.ts.map