import { describe, expect, test } from 'bun:test';
import { generateToken, hashPassword, verifyPassword } from './crypto';

describe('hashPassword/verifyPassword', () => {
  test('roundtrip: correct password verifies', async () => {
    const hash = await hashPassword('PasswordKuat123!');
    expect(await verifyPassword('PasswordKuat123!', hash)).toBe(true);
  });

  test('wrong password fails', async () => {
    const hash = await hashPassword('PasswordKuat123!');
    expect(await verifyPassword('passwordkuat123', hash)).toBe(false);
  });

  test('salted: same password yields different hashes', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  test('empty password rejected', async () => {
    expect(hashPassword('')).rejects.toThrow();
  });

  test('malformed stored hashes fail safely', async () => {
    for (const stored of ['', 'nocolon', ':no-salt', 'no-hash:', '!!!bukan-b64!!!:!!!bukan-b64!!!']) {
      expect(await verifyPassword('x', stored)).toBe(false);
    }
  });
});

describe('generateToken', () => {
  test('64 hex chars, unique per call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
