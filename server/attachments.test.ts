import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock S3 client before importing
let s3Store: Map<string, { body: Buffer; contentType: string }>;

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: { Bucket: string; Key: string; Body: Buffer; ContentType: string };
    constructor(input: { Bucket: string; Key: string; Body: Buffer; ContentType: string }) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }
  class S3Client {
    async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) {
      if (command instanceof PutObjectCommand) {
        const { Key, Body, ContentType } = command.input;
        s3Store.set(Key, { body: Body, contentType: ContentType });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const { Key } = command.input;
        const data = s3Store.get(Key);
        if (!data) {
          const err = new Error("NoSuchKey") as Error & { name: string; $metadata: { httpStatusCode: number } };
          err.name = "NoSuchKey";
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(data.body),
          },
          ContentType: data.contentType,
        };
      }
      if (command instanceof DeleteObjectCommand) {
        const { Key } = command.input;
        s3Store.delete(Key);
        return {};
      }
      throw new Error("Unknown command");
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

import {
  generateAttachmentId,
  validateUpload,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
} from "./attachments";

describe("attachments", () => {
  beforeEach(() => {
    s3Store = new Map();
  });

  describe("generateAttachmentId", () => {
    it("generates IDs starting with 'att-'", () => {
      const id = generateAttachmentId();
      expect(id).toMatch(/^att-\d+-[a-z0-9]+$/);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateAttachmentId()));
      expect(ids.size).toBe(50);
    });
  });

  describe("validateUpload", () => {
    it("accepts valid PDF upload", () => {
      const result = validateUpload("report.pdf", "application/pdf", 1024);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("accepts valid image uploads", () => {
      expect(validateUpload("photo.png", "image/png", 5000).valid).toBe(true);
      expect(validateUpload("photo.jpeg", "image/jpeg", 5000).valid).toBe(true);
      expect(validateUpload("photo.gif", "image/gif", 5000).valid).toBe(true);
      expect(validateUpload("photo.webp", "image/webp", 5000).valid).toBe(true);
    });

    it("accepts valid text-based uploads", () => {
      expect(validateUpload("data.csv", "text/csv", 100).valid).toBe(true);
      expect(validateUpload("notes.txt", "text/plain", 100).valid).toBe(true);
      expect(validateUpload("readme.md", "text/markdown", 100).valid).toBe(true);
      expect(validateUpload("page.html", "text/html", 100).valid).toBe(true);
      expect(validateUpload("config.json", "application/json", 100).valid).toBe(true);
    });

    it("accepts Office documents", () => {
      expect(
        validateUpload("data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 100).valid
      ).toBe(true);
      expect(
        validateUpload("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 100).valid
      ).toBe(true);
      expect(
        validateUpload("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 100).valid
      ).toBe(true);
    });

    it("rejects files too large", () => {
      const result = validateUpload("huge.pdf", "application/pdf", 21 * 1024 * 1024);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("rejects at exactly the limit", () => {
      // 20MB exactly should be accepted (not greater than)
      const result = validateUpload("exact.pdf", "application/pdf", 20 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it("rejects unsupported MIME types", () => {
      const result = validateUpload("app.exe", "application/x-executable", 1024);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects invalid filenames", () => {
      // A single special char becomes "_" after sanitization, which is invalid
      const result = validateUpload("!", "text/plain", 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid filename");
    });

    it("sanitizes filenames with special characters", () => {
      // Filename with spaces and special chars — validation should still pass
      // because the sanitized version will be valid
      const result = validateUpload("my report (final).pdf", "application/pdf", 1024);
      expect(result.valid).toBe(true);
    });
  });

  describe("uploadAttachment", () => {
    it("uploads a text file and extracts text", async () => {
      const buffer = Buffer.from("Hello, this is test content");
      const attachment = await uploadAttachment("test-slug", "notes.txt", "text/plain", buffer);

      expect(attachment.id).toMatch(/^att-/);
      expect(attachment.filename).toBe("notes.txt");
      expect(attachment.mimeType).toBe("text/plain");
      expect(attachment.sizeBytes).toBe(buffer.length);
      expect(attachment.s3Key).toContain("reports/test-slug/attachments/");
      expect(attachment.extractedText).toBe("Hello, this is test content");
      expect(attachment.uploadedAt).toBeDefined();
    });

    it("uploads a CSV file and extracts text", async () => {
      const csv = "name,value\nfoo,1\nbar,2";
      const buffer = Buffer.from(csv);
      const attachment = await uploadAttachment("csv-test", "data.csv", "text/csv", buffer);

      expect(attachment.extractedText).toBe(csv);
    });

    it("uploads a JSON file and extracts text", async () => {
      const json = JSON.stringify({ key: "value" });
      const buffer = Buffer.from(json);
      const attachment = await uploadAttachment("json-test", "config.json", "application/json", buffer);

      expect(attachment.extractedText).toBe(json);
    });

    it("uploads an image and returns a description placeholder", async () => {
      const buffer = Buffer.from("fake-image-data");
      const attachment = await uploadAttachment("img-test", "photo.png", "image/png", buffer);

      expect(attachment.extractedText).toContain("[Image file: photo.png");
      expect(attachment.extractedText).toContain("KB)]");
    });

    it("handles spreadsheet MIME type", async () => {
      const buffer = Buffer.from("fake-spreadsheet-data");
      const attachment = await uploadAttachment(
        "xlsx-test",
        "data.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer
      );

      expect(attachment.extractedText).toContain("[Spreadsheet:");
    });

    it("handles presentation MIME type", async () => {
      const buffer = Buffer.from("fake-pptx-data");
      const attachment = await uploadAttachment(
        "pptx-test",
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer
      );

      expect(attachment.extractedText).toContain("[Presentation:");
    });

    it("stores file in S3 with correct key", async () => {
      const buffer = Buffer.from("test content");
      const attachment = await uploadAttachment("s3-key-test", "file.txt", "text/plain", buffer);

      // Verify S3 has the object
      expect(s3Store.has(attachment.s3Key)).toBe(true);
    });

    it("sanitizes filenames in S3 key", async () => {
      const buffer = Buffer.from("test");
      const attachment = await uploadAttachment("sanitize-test", "my file (1).txt", "text/plain", buffer);

      expect(attachment.filename).toBe("my_file__1_.txt");
      expect(attachment.s3Key).toContain("my_file__1_.txt");
    });
  });

  describe("downloadAttachment", () => {
    it("downloads an existing file", async () => {
      const buffer = Buffer.from("download me");
      const attachment = await uploadAttachment("dl-test", "file.txt", "text/plain", buffer);

      const downloaded = await downloadAttachment(attachment.s3Key);
      expect(downloaded).not.toBeNull();
      expect(downloaded!.buffer.toString()).toBe("download me");
      expect(downloaded!.contentType).toBe("text/plain");
    });

    it("returns null for non-existent key", async () => {
      const result = await downloadAttachment("nonexistent-key");
      expect(result).toBeNull();
    });
  });

  describe("deleteAttachment", () => {
    it("deletes an existing file from S3", async () => {
      const buffer = Buffer.from("delete me");
      const attachment = await uploadAttachment("del-test", "file.txt", "text/plain", buffer);

      expect(s3Store.has(attachment.s3Key)).toBe(true);
      await deleteAttachment(attachment.s3Key);
      expect(s3Store.has(attachment.s3Key)).toBe(false);
    });
  });

  describe("text extraction edge cases", () => {
    it("truncates very large text files to 100k chars", async () => {
      const longText = "a".repeat(150_000);
      const buffer = Buffer.from(longText);
      const attachment = await uploadAttachment("long-test", "big.txt", "text/plain", buffer);

      expect(attachment.extractedText!.length).toBe(100_000);
    });

    it("handles PDF with no extractable text", async () => {
      // A buffer that doesn't contain PDF text streams
      const buffer = Buffer.from("not a real pdf");
      const attachment = await uploadAttachment("no-text-pdf", "empty.pdf", "application/pdf", buffer);

      expect(attachment.extractedText).toContain("[PDF document");
    });

    it("handles DOCX with no w:t elements", async () => {
      const buffer = Buffer.from("not a real docx");
      const attachment = await uploadAttachment(
        "no-text-docx",
        "empty.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer
      );

      expect(attachment.extractedText).toContain("[Word document");
    });

    it("extracts text from DOCX with w:t elements", async () => {
      const docxXml = '<w:t>Hello</w:t> <w:t>World</w:t>';
      const buffer = Buffer.from(docxXml);
      const attachment = await uploadAttachment(
        "docx-text",
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer
      );

      expect(attachment.extractedText).toBe("Hello World");
    });

    it("extracts text from PDF with Tj operators", async () => {
      const pdfContent = "stream\n(Hello PDF) Tj\n(World) Tj\nendstream";
      const buffer = Buffer.from(pdfContent, "latin1");
      const attachment = await uploadAttachment("pdf-text", "doc.pdf", "application/pdf", buffer);

      expect(attachment.extractedText).toContain("Hello PDF");
      expect(attachment.extractedText).toContain("World");
    });
  });
});
