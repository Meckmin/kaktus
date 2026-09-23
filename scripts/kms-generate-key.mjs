#!/usr/bin/env node
/**
 * One-time setup: wraps a fresh 32-byte field-encryption key under an AWS KMS
 * key, so the plaintext key never has to live in an env var or a secrets
 * manager — only KMS's encrypted ciphertext blob does.
 *
 * Prerequisite: a symmetric KMS key already exists (AWS Console → KMS → Create
 * key → Symmetric, "Encrypt and decrypt" usage — or `aws kms create-key`).
 * This script does not create one, deliberately: a KMS key is a standing
 * $1/month cost and a real IAM resource, not something to conjure as a side
 * effect of running a script.
 *
 *   AWS_REGION=eu-central-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
 *     node scripts/kms-generate-key.mjs --key-id alias/kaktus-kocluk-field-encryption
 *
 * Prints the two env vars to add to `.env` (or your host's secret store).
 * Nothing sensitive is written to disk by this script itself.
 */
import { KMSClient, GenerateDataKeyCommand } from '@aws-sdk/client-kms';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const keyId = flag('key-id') ?? process.env.AWS_KMS_KEY_ID;
const region = process.env.AWS_REGION;

if (!keyId) {
  console.error('Missing --key-id (or AWS_KMS_KEY_ID). Pass the KMS key\'s id, ARN, or alias.');
  process.exit(1);
}
if (!region) {
  console.error('Missing AWS_REGION.');
  process.exit(1);
}

const client = new KMSClient({ region });

const result = await client.send(
  new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }),
);

if (!result.CiphertextBlob) {
  console.error('KMS did not return a ciphertext blob.');
  process.exit(1);
}

const ciphertextB64 = Buffer.from(result.CiphertextBlob).toString('base64');

console.log('\nGenerated a new field-encryption key, wrapped under', keyId, 'in', region + '.');
console.log('\nAdd these to .env (or your production secret store) — remove FIELD_ENCRYPTION_KEY,');
console.log('the two systems are mutually exclusive and KMS wins if both are set:\n');
console.log(`FIELD_ENCRYPTION_KMS_CIPHERTEXT="${ciphertextB64}"`);
console.log(`AWS_REGION="${region}"`);
console.log(`AWS_KMS_KEY_ID="${keyId}"`);
console.log(
  '\nThe plaintext key was never written anywhere by this script — only the wrapped',
  'ciphertext above exists outside KMS. Re-run this script to rotate: it produces a new',
  'key every time, independent of any previous one.',
);
