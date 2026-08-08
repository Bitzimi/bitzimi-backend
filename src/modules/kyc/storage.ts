/**
 * Storage Adapter — document file handling.
 *
 * Controls how KYC documents and proof screenshots are stored.
 *
 * STORAGE_BACKEND env var:
 *   "local"  — stores files in ./uploads/ (development default)
 *   "s3"     — stores in AWS S3 (requires AWS_* env vars)
 *
 * TODO(phase-3h): Switch to "s3" for production. All documents are
 * sensitive (government IDs). S3 bucket must be private; access only via
 * presigned URLs with short TTL (1 hour).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getConfigValue } from "../admin/config/admin.config.service";

export type StoredFile = { key: string; url: string };

const BACKEND = process.env.STORAGE_BACKEND ?? "local";
const LOCAL_DIR = join(process.cwd(), "uploads");

if (BACKEND === "local" && !existsSync(LOCAL_DIR)) {
  mkdirSync(LOCAL_DIR, { recursive: true });
}

// ── Local storage (development) ──────────────────────────────────────────────

function saveLocal(ext: string, buffer: Buffer): StoredFile {
  const key = `${randomUUID()}.${ext}`;
  writeFileSync(join(LOCAL_DIR, key), buffer);
  return { key, url: `/uploads/${key}` };
}

function localSignedUrl(key: string): string {
  // In dev, files are served from a static route — no expiry needed.
  return `/uploads/${key}`;
}

// ── S3 storage (production) ───────────────────────────────────────────────────
// Stubbed here; wire in @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
// when AWS credentials are configured.

async function saveS3(_ext: string, _buffer: Buffer): Promise<StoredFile> {
  // TODO(production): implement S3 upload
  // const client = new S3Client({ region: process.env.AWS_REGION });
  // const key = `kyc/${randomUUID()}.${ext}`;
  // await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer }));
  // return { key, url: `s3://${process.env.S3_BUCKET}/${key}` };
  throw new Error("S3 storage not yet configured. Set STORAGE_BACKEND=local for development.");
}

async function s3SignedUrl(_key: string): Promise<string> {
  // TODO(production): generate presigned URL
  // const client = new S3Client({ region: process.env.AWS_REGION });
  // return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: _key }), { expiresIn: 3600 });
  throw new Error("S3 storage not yet configured.");
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * Store a base64 data URL from the frontend.
 * Returns a storage key and local/S3 URL.
 */
export async function storeDocument(dataUrl: string, folder: string): Promise<StoredFile> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw Object.assign(new Error("Invalid data URL format"), { statusCode: 400, code: "INVALID_FILE" });

  const mimeType = match[1];
  const base64   = match[2];
  const buffer   = Buffer.from(base64, "base64");

  // Validate size — limit is controlled by system.max_upload_size_mb (default 5 MB)
  const maxMb = await getConfigValue<number>("system.max_upload_size_mb", 5);
  const maxBytes = maxMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw Object.assign(new Error(`Document exceeds the ${maxMb} MB upload limit`), { statusCode: 400, code: "FILE_TOO_LARGE" });
  }

  const extMap: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png",
    "image/webp": "webp", "application/pdf": "pdf",
  };
  const ext = extMap[mimeType] ?? "bin";
  const key = `${folder}/${randomUUID()}.${ext}`;

  if (BACKEND === "s3") {
    return saveS3(ext, buffer);
  }

  // Local: include folder in path
  const dir = join(LOCAL_DIR, folder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(LOCAL_DIR, key), buffer);
  return { key, url: `/uploads/${key}` };
}

/**
 * Get a URL to access a stored document.
 * In production this is a presigned S3 URL (1h TTL).
 * In dev it is the static local path.
 */
export async function getDocumentUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  if (BACKEND === "s3") return s3SignedUrl(key);
  return localSignedUrl(key);
}
