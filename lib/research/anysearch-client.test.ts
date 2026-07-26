import { expect, it, vi } from "vitest";

import { AnySearchClient, AnySearchError } from "./anysearch-client";

const resultMarkdown = `## Search Results (2 results)

### 1. Official market report
- **URL**: https://example.com/market
- Demand increased during 2026.

### 2. Unsafe result
- **URL**: javascript:alert(1)
- Ignore this result.`;

function successResponse(markdown = resultMarkdown): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: markdown }] },
  });
}

it("calls the AnySearch JSON-RPC search tool without exposing configuration", async () => {
  const fetchImpl = vi.fn(async () => successResponse());
  const client = new AnySearchClient({
    apiKey: "test-anysearch-key",
    fetchImpl: fetchImpl as typeof fetch,
  });

  const sources = await client.search("跨境电商 市场规模");

  expect(fetchImpl).toHaveBeenCalledOnce();
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://api.anysearch.com/mcp");
  expect(new Headers(init?.headers).get("Authorization")).toBe(
    "Bearer test-anysearch-key",
  );
  expect(JSON.parse(String(init?.body))).toEqual({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search",
      arguments: { query: "跨境电商 市场规模", max_results: 3 },
    },
  });
  expect(sources).toEqual([
    {
      title: "Official market report",
      url: "https://example.com/market",
      snippet: "Demand increased during 2026.",
      query: "跨境电商 市场规模",
    },
  ]);
});

it("retries one retryable response and then succeeds", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("busy", { status: 503 }))
    .mockResolvedValueOnce(successResponse());
  const client = new AnySearchClient({ fetchImpl });

  await expect(client.search("market")).resolves.toHaveLength(1);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("returns a stable error after both attempts fail", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("busy", { status: 503 }),
  );
  const client = new AnySearchClient({ fetchImpl });

  await expect(client.search("market")).rejects.toMatchObject<AnySearchError>({
    code: "anysearch_rejected",
    retryable: true,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("limits each default search attempt to ten seconds", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
  const client = new AnySearchClient({ fetchImpl: fetchImpl as typeof fetch });
  const outcome = client.search("market").catch((error: unknown) => error);

  try {
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(outcome).resolves.toMatchObject({ code: "anysearch_timeout" });
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a response without a readable text result", async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
  );
  const client = new AnySearchClient({ fetchImpl: fetchImpl as typeof fetch });

  await expect(client.search("market")).rejects.toMatchObject({
    code: "anysearch_protocol",
  });
});
