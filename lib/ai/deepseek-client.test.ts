import { expect, it, vi } from "vitest";

import { DeepSeekClient, ProviderError } from "./deepseek-client";

const options = {
  endpoint: "https://api.deepseek.com/chat/completions",
  apiKey: "test-key-never-log",
  model: "deepseek-v4-pro",
};

function providerStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

it("sends the official non-streaming thinking JSON request", async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            reasoning_content: "private reasoning",
            content: '{"ok":true}',
          },
        },
      ],
    }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  const result = await client.generate({
    systemPrompt: "Only return json.",
    userPrompt: "untrusted project data",
  });

  expect(result).toEqual({ text: '{"ok":true}', researchAvailable: false });
  expect(fetchImpl).toHaveBeenCalledOnce();
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe(options.endpoint);
  expect(init?.headers).toMatchObject({
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({
    model: "deepseek-v4-pro",
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    stream: false,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Only return json." },
      { role: "user", content: "untrusted project data" },
    ],
  });
  expect(String(init?.body)).not.toContain(options.apiKey);
  expect(String(init?.body)).not.toContain("private reasoning");
});

it("uses a smaller non-thinking request for fast structured tasks", async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({
      choices: [{ message: { content: '{"queries":["market"]}' } }],
    }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  await client.generate({
    systemPrompt: "Only return json.",
    userPrompt: "project data",
    profile: "fast_json",
  });

  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.max_tokens).toBe(2_000);
  expect(body.thinking).toBeUndefined();
  expect(body.reasoning_effort).toBeUndefined();
  expect(body.response_format).toEqual({ type: "json_object" });
});

it("sanitizes provider rejection without exposing secrets or project text", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(`bad ${options.apiKey} untrusted project data`, { status: 401 }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  const error = await client
    .generate({ systemPrompt: "json", userPrompt: "untrusted project data" })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({
    code: "provider_rejected",
    status: 401,
    retryable: false,
  });
  expect(String(error)).not.toContain(options.apiKey);
  expect(String(error)).not.toContain("untrusted project data");
});

it("describes a 403 as an AI permission or quota problem", async () => {
  const fetchImpl = vi.fn(async () => new Response("quota details", { status: 403 }));
  const client = new DeepSeekClient({ ...options, fetchImpl });

  const error = await client
    .generate({ systemPrompt: "json", userPrompt: "data" })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ code: "provider_rejected", status: 403 });
  expect((error as Error).message).toContain("额度");
  expect((error as Error).message).not.toContain("DeepSeek");
});

it("fails before fetch when server configuration is missing", async () => {
  const fetchImpl = vi.fn();

  expect(
    () => new DeepSeekClient({ ...options, apiKey: "", fetchImpl }),
  ).toThrowError(
    expect.objectContaining({ code: "provider_config", retryable: false }),
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("maps AbortError to a retryable timeout", async () => {
  const fetchImpl = vi.fn(async () => {
    throw new DOMException("aborted", "AbortError");
  });
  const client = new DeepSeekClient({ ...options, fetchImpl });

  await expect(
    client.generate({ systemPrompt: "json", userPrompt: "data" }),
  ).rejects.toMatchObject({
    code: "provider_timeout",
    status: 504,
    retryable: true,
  });
});

it("allows long structured responses for 300 seconds by default", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetchImpl = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  const outcome = client
    .generate({ systemPrompt: "json", userPrompt: "data" })
    .catch((error: unknown) => error);

  try {
    await vi.advanceTimersByTimeAsync(299_999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toMatchObject({ code: "provider_timeout" });
  } finally {
    vi.useRealTimers();
  }
});

it("rejects an empty final answer", async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({
      choices: [{ message: { reasoning_content: "reasoning", content: "" } }],
    }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  await expect(
    client.generate({ systemPrompt: "json", userPrompt: "data" }),
  ).rejects.toMatchObject({ code: "provider_protocol", retryable: true });
});

it("streams content deltas and ignores private reasoning deltas", async () => {
  const fetchImpl = vi.fn(async () =>
    providerStream([
      'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"已记录"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"订单证据"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });
  const chunks: string[] = [];

  for await (const chunk of client.stream({
    systemPrompt: "Explain only.",
    userPrompt: "project data",
  })) {
    chunks.push(chunk);
  }

  expect(chunks).toEqual(["已记录", "订单证据"]);
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.stream).toBe(true);
  expect(body.response_format).toBeUndefined();
});

it("streams with document text and image inputs when attachments are present", async () => {
  const fetchImpl = vi.fn(async () =>
    providerStream([
      'data: {"choices":[{"delta":{"content":"image noted"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });

  const chunks: string[] = [];
  for await (const chunk of client.stream({
    systemPrompt: "Explain.",
    userPrompt: "project data",
    attachments: [
      {
        id: "doc-1",
        name: "quote.txt",
        mimeType: "text/plain",
        kind: "document",
        text: "MOQ 500 bottles",
      },
      {
        id: "image-1",
        name: "shelf.png",
        mimeType: "image/png",
        kind: "image",
        dataUrl: "data:image/png;base64,AAAA",
      },
    ],
  })) {
    chunks.push(chunk);
  }

  expect(chunks).toEqual(["image noted"]);
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.messages[1].content).toEqual([
    expect.objectContaining({
      type: "text",
      text: expect.stringContaining("MOQ 500 bottles"),
    }),
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    },
  ]);
});

it("maps an externally aborted stream to a non-retryable stop", async () => {
  const external = new AbortController();
  const fetchImpl = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });
  const consume = async () => {
    for await (const chunk of client.stream({
      systemPrompt: "Explain.",
      userPrompt: "secret project text",
      signal: external.signal,
    })) {
      void chunk;
    }
  };

  const outcome = consume();
  external.abort();

  await expect(outcome).rejects.toMatchObject({
    code: "provider_aborted",
    retryable: false,
  });
});

it("rejects a stream with no final-answer content", async () => {
  const fetchImpl = vi.fn(async () =>
    providerStream([
      'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new DeepSeekClient({ ...options, fetchImpl });
  const consume = async () => {
    for await (const chunk of client.stream({
      systemPrompt: "Explain.",
      userPrompt: "data",
    })) {
      void chunk;
    }
  };

  await expect(consume()).rejects.toMatchObject({
    code: "provider_protocol",
    retryable: true,
  });
});
