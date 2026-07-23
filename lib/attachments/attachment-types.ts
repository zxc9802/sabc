export type ChatAttachmentKind = "document" | "image";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  text?: string;
  dataUrl?: string;
}
