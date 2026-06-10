import type { ConsoleRequest, ValidationResult } from './types.js';
export declare function validateCreateTenant(req: ConsoleRequest): ValidationResult;
export declare function validateUpdateTenant(req: ConsoleRequest, params: Record<string, string>): ValidationResult;
export declare function validateSuspendTenant(_req: ConsoleRequest, params: Record<string, string>): ValidationResult;
export declare function validateRbacPolicy(req: ConsoleRequest): ValidationResult;
export declare function validateMfaPolicy(req: ConsoleRequest): ValidationResult;
export declare function validateRetentionPolicy(req: ConsoleRequest): ValidationResult;
export declare function validateClassificationPolicy(req: ConsoleRequest): ValidationResult;
export declare function validateAuditExport(req: ConsoleRequest): ValidationResult;
/** Read-only operations accept no input and never fail validation. */
export declare function validateNoInput(): ValidationResult;
export declare function validateManageUser(req: ConsoleRequest): ValidationResult;
export declare function validateRotateKey(req: ConsoleRequest): ValidationResult;
export declare function validateManageSecret(req: ConsoleRequest, params: Record<string, string>): ValidationResult;
//# sourceMappingURL=validators.d.ts.map