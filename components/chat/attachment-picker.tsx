"use client";

import { useId } from "react";

import type { ChatAttachment } from "@/lib/attachments/attachment-types";

const ACCEPTED_FILES = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".pdf",
  ".docx",
  "text/*",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");

interface AttachmentPickerProps {
  attachments: ChatAttachment[];
  busy: boolean;
  error: string | null;
  onFilesSelected: (files: File[]) => void;
  onRemove: (id: string) => void;
}

export function AttachmentPicker({
  attachments,
  busy,
  error,
  onFilesSelected,
  onRemove,
}: AttachmentPickerProps) {
  const inputId = useId();

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="inline-flex min-h-9 cursor-pointer items-center border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-decision hover:text-decision"
        >
          添加材料
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          multiple
          accept={ACCEPTED_FILES}
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length > 0) onFilesSelected(files);
          }}
        />
        <span className="text-xs text-muted">支持文档、PDF、Word 和图片</span>
      </div>
      {attachments.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="已添加材料">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="inline-flex min-h-8 items-center gap-2 border border-line bg-[#f7fafc] px-2 text-xs"
            >
              <span>
                {attachment.kind === "image" ? "图片" : "文档"}：{attachment.name}
              </span>
              <button
                type="button"
                className="font-mono text-muted hover:text-annotation"
                disabled={busy}
                aria-label={`移除 ${attachment.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-2 border-l-2 border-annotation px-2 text-xs text-annotation">
          {error}
        </p>
      ) : null}
    </div>
  );
}
