import { expect, it, vi } from "vitest";

import { readChatAttachments } from "./read-chat-attachments";

it("converts images to data URLs without calling the extraction API", async () => {
  const fetcher = vi.fn();

  const attachments = await readChatAttachments(
    [new File(["image-bytes"], "label.png", { type: "image/png" })],
    fetcher as unknown as typeof fetch,
  );

  expect(fetcher).not.toHaveBeenCalled();
  expect(attachments).toEqual([
    expect.objectContaining({
      name: "label.png",
      mimeType: "image/png",
      kind: "image",
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
    }),
  ]);
});

it("extracts document text through the attachment API", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      id: "doc-1",
      name: "quote.txt",
      mimeType: "text/plain",
      kind: "document",
      text: "MOQ 500 bottles",
    }),
  );

  const attachments = await readChatAttachments(
    [new File(["MOQ 500 bottles"], "quote.txt", { type: "text/plain" })],
    fetcher,
  );

  expect(fetcher).toHaveBeenCalledWith("/api/attachments", expect.any(Object));
  expect(attachments).toEqual([
    expect.objectContaining({ name: "quote.txt", text: "MOQ 500 bottles" }),
  ]);
});
