import "server-only";

import type { ResearchSource } from "./research-types";

const DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";

export interface AnySearchClientOptions {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class AnySearchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "AnySearchError";
  }
}

export class AnySearchClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AnySearchClientOptions = {}) {
    this.apiKey = options.apiKey ?? "";
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async search(query: string, signal?: AbortSignal): Promise<ResearchSource[]> {
    let lastError: AnySearchError | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.searchOnce(query, signal);
      } catch (error) {
        if (!(error instanceof AnySearchError) || !error.retryable) throw error;
        lastError = error;
      }
    }

    throw lastError ?? new AnySearchError("外部调研失败。", "anysearch_failed", true);
  }

  private async searchOnce(
    query: string,
    signal?: AbortSignal,
  ): Promise<ResearchSource[]> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-Anysearch-Client": "sabc/1.0",
      });
      if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);

      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search",
            arguments: { query, max_results: 3 },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AnySearchError(
          "外部调研服务暂时未接受请求。",
          "anysearch_rejected",
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        error?: { message?: unknown };
        result?: { content?: Array<{ type?: unknown; text?: unknown }> };
      };
      if (payload.error) {
        throw new AnySearchError(
          "外部调研服务返回错误。",
          "anysearch_rejected",
          false,
        );
      }
      const text = payload.result?.content?.find(
        (item) => item.type === "text" && typeof item.text === "string",
      )?.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new AnySearchError(
          "外部调研服务返回了无法读取的结果。",
          "anysearch_protocol",
          false,
        );
      }

      return parseSearchMarkdown(text, query);
    } catch (error) {
      if (error instanceof AnySearchError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AnySearchError(
          timedOut ? "外部调研服务响应超时。" : "外部调研已取消。",
          timedOut ? "anysearch_timeout" : "anysearch_aborted",
          timedOut,
          timedOut ? 504 : 499,
        );
      }
      throw new AnySearchError(
        "暂时无法连接外部调研服务。",
        "anysearch_unavailable",
        true,
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

export function createAnySearchClientFromEnv(): AnySearchClient {
  return new AnySearchClient({ apiKey: process.env.ANYSEARCH_API_KEY });
}

function parseSearchMarkdown(markdown: string, query: string): ResearchSource[] {
  const blocks = markdown.split(/^###\s+\d+\.\s+/gmu).slice(1);
  const sources: ResearchSource[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/u);
    const title = lines.shift()?.trim() ?? "";
    const urlLine = lines.find((line) => /\*\*URL\*\*:/iu.test(line));
    const rawUrl = urlLine?.replace(/^.*?\*\*URL\*\*:\s*/iu, "").trim() ?? "";
    const url = safeHttpUrl(rawUrl);
    if (!title || !url) continue;

    const snippet = lines
      .filter((line) => line !== urlLine && line.trim())
      .map((line) => line.replace(/^[-*]\s*/u, "").trim())
      .join(" ")
      .slice(0, 2_500);
    sources.push({ title, url, snippet, query });
  }

  return sources;
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
