// Usage: node scripts/hash-password.mjs <password>
// Prints "salt:hash" for manual inserts (psql or Neon SQL Editor).
const ITERATIONS = 100_000, KEY_LEN = 32;
const enc = new TextEncoder();
const toB64 = (buf) => Buffer.from(new Uint8Array(buf)).toString('base64');

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, km, KEY_LEN * 8);
  return `${toB64(salt.buffer)}:${toB64(bits)}`;
}

const pw = process.argv[2];
if (!pw) { console.error('Usage: node scripts/hash-password.mjs <password>'); process.exit(1); }
console.log(await hash(pw));
