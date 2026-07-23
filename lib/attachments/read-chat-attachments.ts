import type { ChatAttachment } from "./attachment-types";

const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function readChatAttachments(
  files: Iterable<File>,
  fetcher: typeof fetch = fetch,
): Promise<ChatAttachment[]> {
  const selected = Array.from(files).slice(0, MAX_ATTACHMENTS);
  const attachments: ChatAttachment[] = [];

  for (const file of selected) {
    if (file.type.startsWith("image/")) {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new AttachmentReadError("图片不能超过 4MB。");
      }
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        kind: "image",
        dataUrl: await fileToDataUrl(file),
      });
      continue;
    }

    const form = new FormData();
    form.set("file", file);
    const response = await fetcher("/api/attachments", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new AttachmentReadError(await readErrorMessage(response));
    }
    attachments.push((await response.json()) as ChatAttachment);
  }

  return attachments;
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Fall through to the generic message.
  }
  return "文件读取失败，请换一个文件或复制文本。";
}

export class AttachmentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentReadError";
  }
}
