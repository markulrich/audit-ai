/**
 * Attachment handling — upload, store, retrieve, and extract text from files.
 *
 * Supports: PDF, images (PNG/JPG/GIF/WebP), CSV, Excel-like text,
 * plain text, markdown, JSON, and other text-based formats.
 *
 * Files are stored in S3 under: reports/{slug}/attachments/{id}-{filename}
 * Text extraction is done server-side for use by the agent skills.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Attachment } from "../shared/types";

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

// Maximum file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate an upload before processing */
export function validateUpload(
  filename: string,
  mimeType: string,
  sizeBytes: number
): { valid: boolean; error?: string } {
  if (sizeBytes > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` };
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}. Supported: PDF, images, text, CSV, JSON, Office documents.`,
    };
  }

  // Sanitize filename
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  if (!sanitized || sanitized === "_") {
    return { valid: false, error: "Invalid filename" };
  }

  return { valid: true };
}

/** Upload a file to S3 and return attachment metadata */
export async function uploadAttachment(
  slug: string,
  filename: string,
  mimeType: string,
  buffer: Buffer
): Promise<Attachment> {
  const id = generateAttachmentId();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const s3Key = `reports/${slug}/attachments/${id}-${sanitizedFilename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  // Extract text content from the file
  const extractedText = await extractText(buffer, mimeType, filename);

  const attachment: Attachment = {
    id,
    filename: sanitizedFilename,
    mimeType,
    sizeBytes: buffer.length,
    s3Key,
    uploadedAt: new Date().toISOString(),
    extractedText: extractedText || undefined,
  };

  return attachment;
}

/** Download an attachment from S3 */
export async function downloadAttachment(
  s3Key: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: s3Key })
    );
    const bytes = await resp.Body!.transformToByteArray();
    return {
      buffer: Buffer.from(bytes),
      contentType: resp.ContentType || "application/octet-stream",
    };
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Delete an attachment from S3 */
export async function deleteAttachment(s3Key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key })
  );
}

/** Extract readable text from a file buffer based on MIME type */
async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  try {
    // Text-based formats: read directly
    if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json"
    ) {
      const text = buffer.toString("utf-8");
      // Truncate to 100k chars to keep context manageable
      return text.slice(0, 100_000);
    }

    // CSV: parse as text (it's already text)
    if (mimeType === "text/csv") {
      return buffer.toString("utf-8").slice(0, 100_000);
    }

    // PDF: basic text extraction (look for text streams)
    if (mimeType === "application/pdf") {
      return extractPdfText(buffer);
    }

    // Images: return a description placeholder (the agent will use vision)
    if (mimeType.startsWith("image/")) {
      return `[Image file: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)]`;
    }

    // Office documents: best-effort text extraction
    if (
      mimeType.includes("spreadsheetml") ||
      mimeType.includes("ms-excel")
    ) {
      return `[Spreadsheet: ${filename} — binary format, agent will analyze structure]`;
    }

    if (mimeType.includes("wordprocessingml")) {
      return extractDocxText(buffer);
    }

    if (mimeType.includes("presentationml")) {
      return `[Presentation: ${filename} — binary format, agent will analyze slides]`;
    }

    return null;
  } catch (err) {
    console.warn(`[attachments] Text extraction failed for ${filename}:`, (err as Error).message);
    return null;
  }
}

/** Unescape PDF string escape sequences (\n, \r, \t, \\, \(, \), octal) */
function unescapePdfString(s: string): string {
  return s.replace(/\\([nrtbf\\()]|[0-7]{1,3})/g, (_, c: string) => {
    switch (c) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      case "\\": return "\\";
      case "(": return "(";
      case ")": return ")";
      default: return String.fromCharCode(parseInt(c, 8)); // octal
    }
  });
}

/** Extract all parenthesized strings from a PDF text stream, handling nested parens */
function extractPdfStrings(stream: string): string[] {
  const strings: string[] = [];
  let i = 0;
  while (i < stream.length) {
    if (stream[i] === "(") {
      let depth = 1;
      let start = i + 1;
      i++;
      while (i < stream.length && depth > 0) {
        if (stream[i] === "\\" ) { i++; } // skip escaped char
        else if (stream[i] === "(") { depth++; }
        else if (stream[i] === ")") { depth--; }
        i++;
      }
      if (depth === 0) {
        strings.push(unescapePdfString(stream.slice(start, i - 1)));
      }
    } else {
      i++;
    }
  }
  return strings;
}

/**
 * PDF text extraction — handles Tj (single string), TJ (array of strings/positions),
 * and ' (move to next line + show string) operators.
 */
function extractPdfText(buffer: Buffer): string {
  const text = buffer.toString("latin1");
  const textParts: string[] = [];

  // Extract text from PDF content streams
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(text)) !== null) {
    const stream = match[1];

    // Method 1: TJ operator — array of strings and positioning values
    // e.g. [(Hello ) -100 (World)] TJ
    const tjArrayRegex = /\[((?:\([^)]*\)|[^])*?)\]\s*TJ/gi;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(stream)) !== null) {
      const arrayContent = tjArrayMatch[1];
      const strings = extractPdfStrings(arrayContent);
      if (strings.length > 0) {
        textParts.push(strings.join(""));
      }
    }

    // Method 2: Tj operator — single string (handles escaped parens)
    // e.g. (Hello World) Tj or (Parens \(here\)) Tj
    const tjRegex = /\(((?:[^\\)]*|\\.)*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(stream)) !== null) {
      textParts.push(unescapePdfString(tjMatch[1]));
    }

    // Method 3: ' operator — move to next line and show string
    // e.g. (Hello World) '
    const quoteRegex = /\(((?:[^\\)]*|\\.)*)\)\s*'/g;
    let quoteMatch: RegExpExecArray | null;
    while ((quoteMatch = quoteRegex.exec(stream)) !== null) {
      textParts.push(unescapePdfString(quoteMatch[1]));
    }
  }

  // Deduplicate consecutive identical strings (common in PDF rendering)
  const deduped: string[] = [];
  for (const part of textParts) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== part) {
      deduped.push(part);
    }
  }

  if (deduped.length === 0) {
    return "[PDF document — text could not be extracted, agent will analyze content]";
  }

  return deduped.join(" ").slice(0, 100_000);
}

/**
 * DOCX text extraction — DOCX is a ZIP containing XML.
 * Extracts text from w:t elements while preserving paragraph and tab structure.
 * Works by scanning the raw bytes for XML patterns (no ZIP library needed
 * since DOCX stores XML content uncompressed in most files, or we can match
 * patterns in the compressed stream for commonly-appearing XML tags).
 */
function extractDocxText(buffer: Buffer): string {
  const text = buffer.toString("utf-8", 0, Math.min(buffer.length, 500_000));

  // Strategy 1: Look for paragraph-level structure (preferred)
  // Paragraphs are <w:p ...> ... </w:p>
  const paragraphs: string[] = [];
  const wpRegex = /<w:p[\s>][^]*?<\/w:p>/g;
  let wpMatch: RegExpExecArray | null;

  while ((wpMatch = wpRegex.exec(text)) !== null) {
    const para = wpMatch[0];

    // Extract all w:t text runs within this paragraph
    const runs: string[] = [];
    const wtRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    let wtMatch: RegExpExecArray | null;

    while ((wtMatch = wtRegex.exec(para)) !== null) {
      runs.push(wtMatch[1]);
    }

    // Handle w:tab elements as tab characters
    const withTabs = para.replace(/<w:tab\s*\/>/g, "\t");
    // Check for tabs between runs
    if (runs.length > 0) {
      // If tab elements exist, insert tabs between text runs
      const hasTabs = withTabs.includes("\t");
      paragraphs.push(runs.join(hasTabs ? "\t" : ""));
    }
  }

  if (paragraphs.length > 0) {
    return paragraphs
      .filter((p) => p.trim().length > 0) // remove empty paragraphs
      .join("\n")
      .slice(0, 100_000);
  }

  // Strategy 2: Fallback — find w:t elements anywhere (handles compressed XML)
  const textParts: string[] = [];
  const wtFallback = /<w:t[^>]*>([^<]+)<\/w:t>/g;
  let match: RegExpExecArray | null;

  while ((match = wtFallback.exec(text)) !== null) {
    textParts.push(match[1]);
  }

  if (textParts.length === 0) {
    return "[Word document — binary format, agent will analyze content]";
  }

  return textParts.join(" ").slice(0, 100_000);
}
