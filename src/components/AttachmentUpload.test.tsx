import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AttachmentUpload from "./AttachmentUpload";
import type { Attachment } from "../../shared/types";

// Polyfill File.arrayBuffer for jsdom (not available in all jsdom versions)
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function () {
    const blob = this as Blob;
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
  };
}

// Some jsdom versions also lack Blob.arrayBuffer
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
}

describe("AttachmentUpload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    slug: "test-slug",
    attachments: [] as Attachment[],
    onAttachmentAdded: vi.fn(),
    onAttachmentRemoved: vi.fn(),
    disabled: false,
  };

  it("renders the drop zone with instructions", () => {
    render(<AttachmentUpload {...defaultProps} />);
    expect(
      screen.getByText(/Drop files or click to attach/)
    ).toBeInTheDocument();
  });

  it("shows disabled state when disabled prop is true", () => {
    render(<AttachmentUpload {...defaultProps} disabled={true} />);
    // The text is nested: outer div (with opacity) > inner div (with text)
    // Go up two levels from the text node to reach the drop zone div
    const textElement = screen.getByText(/Drop files or click to attach/);
    const dropZone = textElement.parentElement!; // the div with border/opacity
    expect(dropZone.style.opacity).toBe("0.5");
  });

  it("renders uploaded attachments", () => {
    const attachments: Attachment[] = [
      {
        id: "att-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024 * 1024, // 1MB
        s3Key: "reports/test/attachments/att-1-report.pdf",
        uploadedAt: "2026-02-09T00:00:00Z",
      },
      {
        id: "att-2",
        filename: "data.csv",
        mimeType: "text/csv",
        sizeBytes: 5120,
        s3Key: "reports/test/attachments/att-2-data.csv",
        uploadedAt: "2026-02-09T00:00:01Z",
        extractedText: "name,value\nfoo,1",
      },
    ];

    render(<AttachmentUpload {...defaultProps} attachments={attachments} />);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("data.csv")).toBeInTheDocument();
    // Check file type labels and sizes (use getAllByText since "PDF" matches drop zone text too)
    expect(screen.getByText(/PDF — 1\.0MB/)).toBeInTheDocument();
    expect(screen.getByText(/CSV — 5\.0KB/)).toBeInTheDocument();
    // att-2 has extractedText so should show "(text extracted)"
    expect(screen.getByText(/text extracted/)).toBeInTheDocument();
  });

  it("shows delete button for each attachment", () => {
    const attachments: Attachment[] = [
      {
        id: "att-1",
        filename: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        s3Key: "k1",
        uploadedAt: "",
      },
    ];

    render(<AttachmentUpload {...defaultProps} attachments={attachments} />);

    const deleteBtn = screen.getByTitle("Remove attachment");
    expect(deleteBtn).toBeInTheDocument();
  });

  it("calls onAttachmentRemoved when delete is clicked", async () => {
    const onRemoved = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const attachments: Attachment[] = [
      {
        id: "att-1",
        filename: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        s3Key: "k1",
        uploadedAt: "",
      },
    ];

    render(
      <AttachmentUpload
        {...defaultProps}
        attachments={attachments}
        onAttachmentRemoved={onRemoved}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Remove attachment"));

    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledWith("att-1");
    });
  });

  it("uploads a file and calls onAttachmentAdded", async () => {
    const onAdded = vi.fn();
    const mockAttachment: Attachment = {
      id: "att-new",
      filename: "uploaded.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      s3Key: "reports/test/attachments/att-new-uploaded.pdf",
      uploadedAt: new Date().toISOString(),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAttachment,
      })
    );

    render(
      <AttachmentUpload
        {...defaultProps}
        onAttachmentAdded={onAdded}
      />
    );

    // Create a file and trigger the input
    const file = new File(["test content"], "uploaded.pdf", {
      type: "application/pdf",
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledWith(mockAttachment);
    });
  });

  it("shows error when upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "File too large" }),
      })
    );

    render(<AttachmentUpload {...defaultProps} />);

    const file = new File(["big content"], "huge.pdf", {
      type: "application/pdf",
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("File too large")).toBeInTheDocument();
    });
  });

  it("shows error when slug is not available", async () => {
    render(
      <AttachmentUpload
        {...defaultProps}
        slug={null}
      />
    );

    const file = new File(["content"], "file.txt", {
      type: "text/plain",
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/No report slug/)).toBeInTheDocument();
    });
  });

  it("shows uploading state", async () => {
    // Make fetch hang to keep uploading state visible
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})) // Never resolves
    );

    render(<AttachmentUpload {...defaultProps} />);

    const file = new File(["content"], "file.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Uploading...")).toBeInTheDocument();
    });
  });

  it("does not render attachment list when empty", () => {
    render(<AttachmentUpload {...defaultProps} attachments={[]} />);

    // There should be no delete buttons
    expect(screen.queryByTitle("Remove attachment")).not.toBeInTheDocument();
  });

  it("displays bytes correctly for small files", () => {
    const attachments: Attachment[] = [
      {
        id: "att-1",
        filename: "tiny.txt",
        mimeType: "text/plain",
        sizeBytes: 42,
        s3Key: "k1",
        uploadedAt: "",
      },
    ];

    render(<AttachmentUpload {...defaultProps} attachments={attachments} />);
    expect(screen.getByText(/42B/)).toBeInTheDocument();
  });
});
