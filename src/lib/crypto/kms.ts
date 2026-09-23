import 'server-only';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

/**
 * Envelope encryption via AWS KMS.
 *
 * `field.ts` needs a 32-byte AES key in memory to do its actual encrypt/decrypt
 * work — calling out to KMS on every single field read would be slow (a network
 * round trip per row) and expensive (KMS bills per API call). So KMS is used the
 * standard way: once, at boot, to unwrap a "data encryption key" (DEK) that then
 * lives in memory for the life of the process. `field.ts`'s own interface never
 * changes — this module's only job is producing the same 32-byte key it already
 * knows how to use, sourced from KMS instead of a plaintext env var.
 *
 * The DEK is generated once, out of band, with `scripts/kms-generate-key.mjs`.
 * That script never writes the plaintext key anywhere — only the KMS-encrypted
 * ciphertext blob is persisted (as `FIELD_ENCRYPTION_KMS_CIPHERTEXT`). Losing
 * that env var does not lose the key: it can be re-derived by anyone holding
 * `decrypt` permission on the KMS key, which is the entire point — the key
 * material's blast radius is now "whoever has IAM access to this KMS key", not
 * "whoever can read this env var or this database dump".
 */

export function kmsConfigured(): boolean {
  return Boolean(process.env.FIELD_ENCRYPTION_KMS_CIPHERTEXT && process.env.AWS_REGION);
}

/**
 * Decrypts the stored DEK ciphertext through KMS.
 *
 * Passing `KeyId` on the Decrypt call, when we have one, is deliberate defence
 * against a confused-deputy mistake: without it, KMS will happily decrypt any
 * ciphertext blob you hand it, from any key you have `kms:Decrypt` on. Pinning
 * the key id means a ciphertext blob that was somehow swapped for one encrypted
 * under a different key fails loudly instead of silently "working".
 */
export async function resolveFieldEncryptionKeyFromKms(): Promise<Buffer> {
  const ciphertextB64 = process.env.FIELD_ENCRYPTION_KMS_CIPHERTEXT;
  const region = process.env.AWS_REGION;
  if (!ciphertextB64 || !region) {
    throw new Error(
      'FIELD_ENCRYPTION_KMS_CIPHERTEXT and AWS_REGION must both be set to resolve the field encryption key from KMS.',
    );
  }

  const client = new KMSClient({ region });
  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertextB64, 'base64'),
      KeyId: process.env.AWS_KMS_KEY_ID || undefined,
    }),
  );

  if (!result.Plaintext) {
    throw new Error('KMS Decrypt returned no plaintext for the field encryption key.');
  }
  const key = Buffer.from(result.Plaintext);
  if (key.length !== 32) {
    throw new Error(`KMS-decrypted field encryption key is ${key.length} bytes, expected 32.`);
  }
  return key;
}
