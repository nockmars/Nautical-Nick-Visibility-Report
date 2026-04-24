/**
 * lib/auth/password.ts
 *
 * Argon2id password hashing for Phase 1 of the Next.js migration.
 *
 * Parameters follow OWASP 2023 recommendations:
 *   - memory: 19456 KiB (~19 MB)
 *   - iterations: 2
 *   - parallelism: 1
 *
 * The timing-constant path for wrong-user attempts is handled in the
 * login route by always running verifyPassword even when no user is found
 * (passing a dummy hash). This matches the vanilla api/auth.js behavior.
 */

import argon2 from 'argon2';

// OWASP 2023 Argon2id minimum params
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,
} as const;

/**
 * Hash a plaintext password with Argon2id.
 * Returns the encoded hash string (includes salt + params).
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash.
 * Returns true if they match, false otherwise.
 * argon2.verify is timing-safe by design.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash string or other internal error → treat as mismatch
    return false;
  }
}

/**
 * A dummy hash used on the wrong-user timing path.
 * We generate it once at module load time so the cost is paid upfront,
 * not on every failed login attempt.
 *
 * Usage in login route: when no user is found, call
 *   verifyPassword(submittedPassword, DUMMY_HASH)
 * to burn ~the same Argon2 cycles as a real verification would.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$dW1teS1zYWx0LWZvcm5hdXRpY2Fsbmljawo$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
