/**
 * Report storage backed by Tigris (Fly.io S3-compatible object storage).
 *
 * Object key layout:
 *   reports/{slug}/meta.json   – slug metadata + current version pointer
 *   reports/{slug}/v{N}.json   – full report snapshot for version N
 *
 * When BUCKET_NAME and AWS_ENDPOINT_URL_S3 are not set (local dev),
 * falls back to the local filesystem under .data/reports/.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_DATA_DIR = join(__dirname, "..", ".data", "reports");

// ── Detect storage backend ─────────────────────────────────────────────────────

const BUCKET = process.env.BUCKET_NAME;
const S3_ENDPOINT = process.env.AWS_ENDPOINT_URL_S3;

const useS3 = Boolean(BUCKET && S3_ENDPOINT);

let s3;
if (useS3) {
  s3 = new S3Client({
    region: process.env.AWS_REGION || "auto",
    endpoint: S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  console.log(`[storage] Using Tigris bucket: ${BUCKET}`);
} else {
  console.log(`[storage] No BUCKET_NAME configured — using local filesystem (.data/reports/)`);
}

// ── Low-level helpers ───────────────────────────────────────────────────────────

async function putObject(key, body) {
  if (useS3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: "application/json",
      })
    );
  } else {
    const filePath = join(LOCAL_DATA_DIR, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
  }
}

async function getObject(key) {
  if (useS3) {
    try {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key })
      );
      const text = await resp.Body.transformToString("utf-8");
      return JSON.parse(text);
    } catch (err) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  } else {
    try {
      const filePath = join(LOCAL_DATA_DIR, key);
      const text = await readFile(filePath, "utf-8");
      return JSON.parse(text);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
}

// ── Slug generation ─────────────────────────────────────────────────────────────

function generateSlug(meta) {
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

/**
 * Publish a report. Creates a new version under an existing slug, or
 * generates a new slug if none is provided.
 *
 * @param {object} report  – The full report object { meta, sections, findings }
 * @param {string} [existingSlug] – Re-publish under an existing slug (new version)
 * @returns {{ slug: string, version: number, url: string }}
 */
export async function publishReport(report, existingSlug) {
  let slug = existingSlug;
  let meta;

  if (slug) {
    meta = await getObject(`reports/${slug}/meta.json`);
    if (!meta) {
      throw new Error(`Report slug "${slug}" not found`);
    }
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

  const version = meta.currentVersion + 1;

  // Store the versioned snapshot
  await putObject(`reports/${slug}/v${version}.json`, {
    version,
    publishedAt: new Date().toISOString(),
    report,
  });

  // Update meta pointer
  meta.currentVersion = version;
  meta.updatedAt = new Date().toISOString();
  meta.title = report.meta?.title || meta.title;
  meta.ticker = report.meta?.ticker || meta.ticker;
  await putObject(`reports/${slug}/meta.json`, meta);

  return { slug, version, url: `/reports/${slug}` };
}

/**
 * Retrieve a published report.
 *
 * @param {string} slug
 * @param {number} [version] – Specific version, or latest if omitted
 * @returns {{ meta, version, publishedAt, report } | null}
 */
export async function getReport(slug, version) {
  const meta = await getObject(`reports/${slug}/meta.json`);
  if (!meta) return null;

  const v = version || meta.currentVersion;
  const data = await getObject(`reports/${slug}/v${v}.json`);
  if (!data) return null;

  return {
    slug: meta.slug,
    currentVersion: meta.currentVersion,
    createdAt: meta.createdAt,
    ...data,
  };
}
