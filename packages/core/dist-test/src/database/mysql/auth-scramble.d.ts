/**
 * Compute mysql_native_password response:
 *   SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))
 * @internal
 */
export declare function nativePasswordHash(password: string, seed: Buffer): Buffer;
/**
 * Compute caching_sha2_password challenge response:
 *   XOR(SHA256(password), SHA256(SHA256(SHA256(password)) + seed))
 *
 * An empty password yields an empty (zero-length) response, matching the
 * MySQL client protocol — the server treats an empty scramble as "no password".
 * @internal
 */
export declare function sha2PasswordHash(password: string, seed: Buffer): Buffer;
//# sourceMappingURL=auth-scramble.d.ts.map