/**
 * Report storage backed by S3-compatible object storage (Tigris on Fly.io).
 *
 * Object key layout:
 *   reports/{slug}/meta.json   – slug metadata + current version pointer
 *   reports/{slug}/v{N}.json   – full report snapshot for version N
 *
 * Requires BUCKET_NAME and AWS_ENDPOINT_URL_S3 environment variables.
 * On Fly.io, `fly storage create` automatically sets BUCKET_NAME,
 * AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * and AWS_REGION as secrets on the app — no manual config needed.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Report, ChatMessage } from "../shared/types";

// ── S3 client ─────────────────────────────────────────────────────────────────

const BUCKET = process.env.BUCKET_NAME;
const S3_ENDPOINT = process.env.AWS_ENDPOINT_URL_S3;

const s3 = new S3Client({
  region: process.env.AWS_REGION || "auto",
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

console.log(`[storage] Using S3 bucket: ${BUCKET} (endpoint: ${S3_ENDPOINT})`);

interface SlugMeta {
  slug: string;
  title: string;
  ticker: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface VersionSnapshot {
  version: number;
  publishedAt: string;
  report: Report;
  messages?: ChatMessage[];
}

// ── Low-level helpers ───────────────────────────────────────────────────────────

async function putObject(key: string, body: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: "application/json",
    })
  );
}

async function getObject<T = unknown>(key: string): Promise<T | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    );
    const text = await resp.Body!.transformToString("utf-8");
    return JSON.parse(text) as T;
  } catch (thrown: unknown) {
    const err = thrown as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
    throw thrown;
  }
}

// ── Slug generation ─────────────────────────────────────────────────────────────

function generateSlug(meta: Report["meta"]): string {
  const base = (meta?.ticker || meta?.title || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

  // 4-char random suffix to avoid collisions
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// ── Public API ──────────────────────────────────────────────────────────────────

export async function saveReport(
  report: Report,
  existingSlug?: string,
  messages?: ChatMessage[],
): Promise<{ slug: string; version: number; url: string }> {
  let slug = existingSlug;
  let meta: SlugMeta | undefined;

  if (slug) {
    const existing = await getObject<SlugMeta>(`reports/${slug}/meta.json`);
    if (!existing) {
      throw new Error(`Report slug "${slug}" not found`);
    }
    meta = existing;
  }

  if (!slug) {
    slug = generateSlug(report.meta);
    meta = {
      slug,
      title: report.meta?.title || "Untitled Report",
      ticker: report.meta?.ticker || null,
      currentVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const version = meta!.currentVersion + 1;

  // Store the versioned snapshot (report + conversation)
  const snapshot: VersionSnapshot = {
    version,
    publishedAt: new Date().toISOString(),
    report,
    ...(messages && messages.length > 0 ? { messages } : {}),
  };
  await putObject(`reports/${slug}/v${version}.json`, snapshot);

  // Update meta pointer
  meta!.currentVersion = version;
  meta!.updatedAt = new Date().toISOString();
  meta!.title = report.meta?.title || meta!.title;
  meta!.ticker = report.meta?.ticker || meta!.ticker;
  await putObject(`reports/${slug}/meta.json`, meta);

  return { slug, version, url: `/reports/${slug}` };
}

/** @deprecated Use saveReport instead */
export const publishReport = saveReport;

export async function getReport(
  slug: string,
  version?: number
): Promise<{ slug: string; currentVersion: number; createdAt: string; version: number; publishedAt: string; report: Report; messages?: ChatMessage[] } | null> {
  const meta = await getObject<SlugMeta>(`reports/${slug}/meta.json`);
  if (!meta) return null;

  const v = version || meta.currentVersion;
  const data = await getObject<VersionSnapshot>(`reports/${slug}/v${v}.json`);
  if (!data) return null;

  return {
    slug: meta.slug,
    currentVersion: meta.currentVersion,
    createdAt: meta.createdAt,
    ...data,
  };
}

export async function listReports(): Promise<SlugMeta[]> {
  const slugs: string[] = [];

  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "reports/",
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );
    for (const prefix of resp.CommonPrefixes || []) {
      // prefix.Prefix is e.g. "reports/my-slug/"
      const slug = prefix.Prefix?.replace(/^reports\//, "").replace(/\/$/, "");
      if (slug) slugs.push(slug);
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  const metas: SlugMeta[] = [];
  for (const slug of slugs) {
    const meta = await getObject<SlugMeta>(`reports/${slug}/meta.json`);
    if (meta) metas.push(meta);
  }

  // Sort by most recently updated first
  metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return metas;
}

// ── Health check ────────────────────────────────────────────────────────────────

export async function checkS3Health(): Promise<{ ok: boolean; bucket: string | undefined; endpoint: string | undefined; error?: string }> {
  const missing: string[] = [];
  if (!BUCKET) missing.push("BUCKET_NAME");
  if (!S3_ENDPOINT) missing.push("AWS_ENDPOINT_URL_S3");
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    return { ok: false, bucket: BUCKET, endpoint: S3_ENDPOINT, error: `Missing env vars: ${missing.join(", ")}. Run \`fly storage create\` or set them manually.` };
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, bucket: BUCKET, endpoint: S3_ENDPOINT };
  } catch (err: unknown) {
    return { ok: false, bucket: BUCKET, endpoint: S3_ENDPOINT, error: err instanceof Error ? err.message : String(err) };
  }
}
