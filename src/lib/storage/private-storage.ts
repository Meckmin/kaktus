import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '@/lib/env';

/**
 * Private storage for verification documents.
 *
 * These are ÖSYM result documents and student ID cards belonging to people who
 * are frequently minors. Two rules follow and neither is negotiable:
 *
 *   1. The bucket is private. We store an object key, never a URL. Reads happen
 *      through a short-lived signed URL issued to an authenticated admin.
 *   2. Nothing is served from the app's public directory, ever. A file under
 *      `/public` is world-readable the moment its name is guessed.
 *
 * The local driver exists so `npm run dev` works without cloud credentials. It
 * writes outside the served tree and refuses to run in production.
 */

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PrivateStorage {
  readonly name: string;
  put(args: {
    /** Logical folder, e.g. `verification/<coachProfileId>`. */
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject>;
  /**
   * A short-lived URL for reading one stored object.
   *
   * Documents are never public — this is how the verification queue shows a
   * reviewer an ÖSYM result without the file ever becoming fetchable by anyone
   * holding its key. The link expires; reviewing a document twice means asking
   * for it twice, which is the correct cost.
   */
  signedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;
}

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export class DocumentRejected extends Error {
  constructor(
    message: string,
    readonly code: 'TOO_LARGE' | 'BAD_TYPE' | 'EMPTY' | 'CONTENT_MISMATCH',
  ) {
    super(message);
    this.name = 'DocumentRejected';
  }
}

/**
 * Validates a candidate upload.
 *
 * The magic-byte check matters more than the MIME header: the browser-supplied
 * `type` is trivially spoofed, and a private bucket full of files whose real
 * contents nobody verified is how a document store becomes a malware host.
 */
export function validateDocument(file: { size: number; type: string }, body: Buffer): void {
  if (body.length === 0) throw new DocumentRejected('Dosya boş.', 'EMPTY');
  if (body.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejected('Dosya 8 MB sınırını aşıyor.', 'TOO_LARGE');
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new DocumentRejected('Yalnızca PDF, JPG veya PNG yükleyebilirsin.', 'BAD_TYPE');
  }

  const declared = file.type;
  const actual = sniff(body);
  if (actual && actual !== declared) {
    throw new DocumentRejected(
      'Dosya içeriği uzantısıyla uyuşmuyor.',
      'CONTENT_MISMATCH',
    );
  }
}

function sniff(body: Buffer): string | null {
  if (body.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function safeExtension(filename: string, contentType: string): string {
  const byType: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return byType[contentType] ?? 'bin';
}

/** Development driver. Writes to `.private-uploads/`, outside the served tree. */
class LocalDiskStorage implements PrivateStorage {
  readonly name = 'local-disk';
  private readonly root = join(process.cwd(), '.private-uploads');

  async put(args: {
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject> {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'LocalDiskStorage refuses to run in production. Configure Supabase Storage.',
      );
    }
    // The stored name is generated, never taken from the upload: a filename is
    // attacker-controlled and path traversal here would write anywhere on disk.
    const key = `${args.prefix}/${randomUUID()}.${safeExtension(args.filename, args.contentType)}`;
    const target = join(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, args.body);
    return { storageKey: key, sizeBytes: args.body.length, mimeType: args.contentType };
  }

  async signedUrl(storageKey: string): Promise<string> {
    // In development the reviewer opens the file from disk. Deliberately not a
    // served URL: wiring a route that streams arbitrary stored keys is exactly
    // the mistake this class of storage exists to avoid.
    return `file://${join(this.root, storageKey)}`;
  }
}

class SupabaseStorage implements PrivateStorage {
  readonly name = 'supabase';

  constructor(
    private readonly config: { url: string; serviceRoleKey: string; bucket: string },
  ) {}

  async put(args: {
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject> {
    const key = `${args.prefix}/${randomUUID()}.${safeExtension(args.filename, args.contentType)}`;
    const endpoint = `${this.config.url}/storage/v1/object/${this.config.bucket}/${key}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': args.contentType,
        'x-upsert': 'false',
      },
      body: new Uint8Array(args.body),
    });

    if (!response.ok) {
      throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
    }
    return { storageKey: key, sizeBytes: args.body.length, mimeType: args.contentType };
  }

  async signedUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
    const endpoint = `${this.config.url}/storage/v1/object/sign/${this.config.bucket}/${storageKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new Error(`Could not sign document URL (${response.status})`);
    }
    const data = (await response.json()) as { signedURL?: string };
    if (!data.signedURL) throw new Error('Storage returned no signed URL');
    return `${this.config.url}/storage/v1${data.signedURL}`;
  }
}

let cached: PrivateStorage | null = null;

export function getPrivateStorage(): PrivateStorage {
  if (cached) return cached;

  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  cached =
    url && serviceRoleKey
      ? new SupabaseStorage({
          url,
          serviceRoleKey,
          bucket: env.SUPABASE_VERIFICATION_BUCKET,
        })
      : new LocalDiskStorage();

  return cached;
}

/** Convenience wrapper used by the admin verification queue. */
export async function getDocumentUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
  return getPrivateStorage().signedUrl(storageKey, expiresInSeconds);
}
