/**
 * Tests for lib/auth/password.ts
 *
 * Verifies Argon2id hash/verify behavior and timing-safe dummy hash.
 */

import { hashPassword, verifyPassword, DUMMY_HASH } from '../password';

describe('hashPassword', () => {
  it('returns a string starting with the argon2id identifier', async () => {
    const hash = await hashPassword('correcthorsebatterystaple');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('produces a different hash each call (unique salts)', async () => {
    const hash1 = await hashPassword('samepassword');
    const hash2 = await hashPassword('samepassword');
    expect(hash1).not.toBe(hash2);
  });

  it('embeds the OWASP memory cost m=19456 in the hash string', async () => {
    const hash = await hashPassword('testpassword');
    expect(hash).toContain('m=19456');
  });

  it('embeds time cost t=2 in the hash string', async () => {
    const hash = await hashPassword('testpassword');
    expect(hash).toContain('t=2');
  });
});

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const hash = await hashPassword('correctpassword');
    const result = await verifyPassword('correctpassword', hash);
    expect(result).toBe(true);
  });

  it('returns false for an incorrect password', async () => {
    const hash = await hashPassword('correctpassword');
    const result = await verifyPassword('wrongpassword', hash);
    expect(result).toBe(false);
  });

  it('returns false for a malformed hash string', async () => {
    const result = await verifyPassword('password', 'not-a-valid-hash');
    expect(result).toBe(false);
  });

  it('is timing-safe: wrong password against DUMMY_HASH does not throw', async () => {
    // The dummy hash path must complete without error so login timing is uniform
    await expect(verifyPassword('anypassword', DUMMY_HASH)).resolves.toBe(false);
  });
});

describe('DUMMY_HASH', () => {
  it('is an argon2id hash string', () => {
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
  });

  it('contains the correct OWASP params', () => {
    expect(DUMMY_HASH).toContain('m=19456');
    expect(DUMMY_HASH).toContain('t=2');
    expect(DUMMY_HASH).toContain('p=1');
  });
});
