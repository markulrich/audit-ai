/**
 * AttachmentUpload — file upload zone for report attachments.
 *
 * Supports drag-and-drop and click-to-browse. Shows uploaded files with
 * metadata and delete buttons. Files are uploaded to the server immediately
 * and added to the current report's job.
 */

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import type { Attachment } from "../../shared/types";

interface AttachmentUploadProps {
  slug: string | null;
  attachments: Attachment[];
  onAttachmentAdded: (attachment: Attachment) => void;
  onAttachmentRemoved: (id: string) => void;
  disabled?: boolean;
}

const MIME_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "text/plain": "Text",
  "text/csv": "CSV",
  "text/markdown": "Markdown",
  "text/html": "HTML",
  "application/json": "JSON",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  if (mimeType.startsWith("image/")) return "\u{1F5BC}";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "\u{1F4CA}";
  if (mimeType.includes("wordprocessing")) return "\u{1F4DD}";
  if (mimeType.includes("presentation")) return "\u{1F4CA}";
  if (mimeType === "text/csv") return "\u{1F4CA}";
  if (mimeType === "application/json") return "{ }";
  return "\u{1F4CE}";
}

export default function AttachmentUpload({
  slug,
  attachments,
  onAttachmentAdded,
  onAttachmentRemoved,
  disabled,
}: AttachmentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    if (!slug) {
      setUploadError("No report slug available. Start a report first.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/reports/${slug}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: buffer,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed: ${res.status}`);
      }

      const attachment = await res.json() as Attachment;
      onAttachmentAdded(attachment);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }, [slug, onAttachmentAdded]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      uploadFile(file);
    }
  }, [uploadFile]);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      uploadFile(file);
    }
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }, [uploadFile]);

  const handleDelete = useCallback(async (id: string) => {
    if (!slug) return;
    try {
      await fetch(`/api/reports/${slug}/attachments/${id}`, { method: "DELETE" });
      onAttachmentRemoved(id);
    } catch (err) {
      console.error("Failed to delete attachment:", err);
    }
  }, [slug, onAttachmentRemoved]);

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "#6366f1" : "#e2e4ea"}`,
          borderRadius: 8,
          padding: "12px 16px",
          textAlign: "center",
          cursor: disabled ? "default" : "pointer",
          background: isDragging ? "#6366f108" : "transparent",
          transition: "all 0.15s ease",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.html,.json,.xlsx,.xls,.docx,.pptx"
        />
        <div style={{ fontSize: 12, color: "#8a8ca5", fontWeight: 500 }}>
          {isUploading
            ? "Uploading..."
            : isDragging
            ? "Drop files here"
            : "Drop files or click to attach (PDF, images, CSV, Excel, Word)"}
        </div>
      </div>

      {/* Error */}
      {uploadError && (
        <div style={{
          marginTop: 6,
          fontSize: 11,
          color: "#b91c1c",
          padding: "4px 8px",
          background: "#b91c1c08",
          borderRadius: 4,
        }}>
          {uploadError}
        </div>
      )}

      {/* Attachment list */}
      {attachments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {attachments.map((att) => (
            <div
              key={att.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: "#f8f9fa",
                borderRadius: 6,
                marginBottom: 4,
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {getFileIcon(att.mimeType)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600,
                  color: "#1a1a2e",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {att.filename}
                </div>
                <div style={{ color: "#8a8ca5", fontSize: 10 }}>
                  {MIME_TYPE_LABELS[att.mimeType] || att.mimeType} — {formatBytes(att.sizeBytes)}
                  {att.extractedText ? " (text extracted)" : ""}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(att.id); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#8a8ca5",
                  fontSize: 14,
                  padding: "2px 4px",
                  borderRadius: 4,
                  lineHeight: 1,
                }}
                title="Remove attachment"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
