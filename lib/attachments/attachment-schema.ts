import { z } from "zod";

export const chatAttachmentSchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  kind: z.enum(["document", "image"]),
  text: z.string().max(12_000).optional(),
  dataUrl: z
    .string()
    .max(6_000_000)
    .regex(/^data:image\/(?:png|jpeg|jpg|webp);base64,/u)
    .optional(),
});

export const chatAttachmentsSchema = z.array(chatAttachmentSchema).max(6);
