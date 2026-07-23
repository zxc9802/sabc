import "server-only";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form", "上传内容不是有效的表单数据。");
  }

  const file = form.get("file");
  if (!isUploadedFile(file)) {
    return errorResponse(400, "missing_file", "请选择一个文档文件。");
  }
  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(413, "file_too_large", "文件不能超过 10MB。");
  }

  const mimeType = normalizeMimeType(file);
  try {
    const text = await extractText(file, mimeType);
    return Response.json({
      id: crypto.randomUUID(),
      name: file.name,
      mimeType,
      kind: "document",
      text: truncateText(text),
    });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(422, "extract_failed", "文档读取失败，请换一个文件或复制文本上传。");
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "type" in value &&
    "size" in value &&
    "arrayBuffer" in value &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}

async function extractText(file: File, mimeType: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isTextDocument(file.name, mimeType)) {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === DOCX_MIME || file.name.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new AttachmentError(
    415,
    "unsupported_file",
    "暂时支持 TXT、Markdown、CSV、JSON、PDF 和 Word docx。",
  );
}

function normalizeMimeType(file: File): string {
  const lowerName = file.name.toLowerCase();
  if (file.type) return file.type;
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".docx")) return DOCX_MIME;
  if (lowerName.endsWith(".md")) return "text/markdown";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".json")) return "application/json";
  return "text/plain";
}

function isTextDocument(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  );
}

function truncateText(text: string): string {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (normalized.length <= MAX_TEXT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_TEXT_CHARS)}\n\n[文档过长，已截断]`;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message, retryable: status >= 500 }, { status });
}

class AttachmentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}
