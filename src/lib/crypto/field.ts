import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for the handful of columns that must not be readable
 * from a database dump: national ID numbers, IBANs, and original message bodies
 * retained as dispute evidence.
 *
 * AES-256-GCM, so the ciphertext is authenticated — a tampered value fails to
 * decrypt rather than silently returning garbage that then gets sent to a bank.
 *
 * On its own, a plaintext key in `FIELD_ENCRYPTION_KEY` protects against a
 * leaked backup or a read-only SQL injection, not against an attacker who
 * already has the app's environment. `setFieldEncryptionKey` below is the
 * upgrade path: `src/instrumentation.ts` calls it once at boot with a key
 * unwrapped from AWS KMS (see `src/lib/crypto/kms.ts`) when KMS is configured,
 * and every call site here is unaffected — `encryptField`/`decryptField` don't
 * know or care where the key came from.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

/**
 * Installs a key resolved elsewhere (KMS today; a future secrets manager
 * tomorrow) so `key()` below never falls through to the plaintext env var.
 * Called once, at boot, by `src/instrumentation.ts` — never mid-request,
 * since swapping the key under in-flight encrypt/decrypt calls would be a
 * hard-to-diagnose way to corrupt data.
 */
export function setFieldEncryptionKey(raw: Buffer): void {
  if (raw.length !== 32) {
    throw new Error(`Field encryption key must be exactly 32 bytes, got ${raw.length}.`);
  }
  cachedKey = raw;
}

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    // Fail at first use rather than encrypting with a short key and discovering
    // it during an incident.
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${decoded.length}.`,
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** Layout: [12-byte IV][16-byte auth tag][ciphertext] */
export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(payload: Buffer | Uint8Array): string {
  const buffer = Buffer.from(payload);
  if (buffer.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext is too short to be valid');
  }

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** True when a key is configured — lets callers degrade rather than crash. */
export function encryptionAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turkish identifier validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TCKN checksum.
 *
 * Validating locally means a typo is caught in the form rather than three days
 * later as an opaque Iyzico rejection, by which point the coach has given up.
 * It proves the number is well-formed, not that it belongs to this person —
 * only Iyzico's own verification does that.
 */

/**
 * `import 'server-only'` at the top is load-bearing.
 *
 * If a Client Component ever imports this module again — directly or through a
 * barrel file — the build fails immediately with a message naming the file,
 * instead of producing an obscure "Can't resolve 'crypto'" error or, worse,
 * shipping key-handling code to the browser. Identifier validators live in
 * `@/lib/coach/identifiers` precisely so nobody needs to reach in here for them.
 */
