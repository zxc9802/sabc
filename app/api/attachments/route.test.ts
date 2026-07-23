import { expect, it } from "vitest";

import { POST } from "./route";

it("extracts text from an uploaded plain document", async () => {
  const form = new FormData();
  form.set(
    "file",
    new File(["Factory quote: MOQ 500 bottles"], "quote.txt", {
      type: "text/plain",
    }),
  );

  const response = await POST({ formData: async () => form } as Request);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    name: "quote.txt",
    mimeType: "text/plain",
    kind: "document",
    text: "Factory quote: MOQ 500 bottles",
  });
});

it("rejects unsupported file types without echoing file content", async () => {
  const form = new FormData();
  form.set(
    "file",
    new File(["secret binary"], "archive.zip", {
      type: "application/zip",
    }),
  );

  const response = await POST({ formData: async () => form } as Request);

  expect(response.status).toBe(415);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("secret binary");
});
