import type { ChatAttachment } from "./attachment-types";

export function appendAttachmentSummary(
  content: string,
  attachments: ChatAttachment[] = [],
): string {
  if (attachments.length === 0) return content;
  const summary = attachments
    .map((attachment) => {
      const label = attachment.kind === "image" ? "图片" : "文档";
      return `- ${label}：${attachment.name}`;
    })
    .join("\n");
  return `${content}\n\n[本轮已上传材料]\n${summary}`;
}
