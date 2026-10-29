import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const derived = await derive(password, salt, 64, options);
  return { scheme: 'scrypt-v1', salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password, stored) {
  if (stored?.scheme !== 'scrypt-v1' ||
      !/^[a-f0-9]{64}$/.test(stored.salt ?? '') ||
      !/^[a-f0-9]{128}$/.test(stored.hash ?? '')) return false;
  const derived = await derive(password, stored.salt, 64, options);
  return timingSafeEqual(derived, Buffer.from(stored.hash, 'hex'));
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex');
}
