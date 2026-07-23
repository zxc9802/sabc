import "server-only";

import type { ChatAttachment } from "@/lib/attachments/attachment-types";

export interface GenerateResult {
  text: string;
  researchAvailable: false;
}

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  attachments?: ChatAttachment[];
  signal?: AbortSignal;
}

export interface DeepSeekClientOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class DeepSeekClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekClientOptions) {
    if (!options.endpoint || !options.apiKey || !options.model) {
      throw new ProviderError(
        "AI 服务端配置不完整，请检查本地环境变量。",
        "provider_config",
        503,
        false,
      );
    }

    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(input),
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 12_000,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderError(
          providerRejectionMessage(response.status),
          "provider_rejected",
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new ProviderError(
          "AI 服务返回了空结果，请重新分析。",
          "provider_protocol",
          502,
          true,
        );
      }

      return { text: content.trim(), researchAvailable: false };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (input.signal?.aborted && !timedOut) {
          throw new ProviderError(
            "已停止生成。",
            "provider_aborted",
            499,
            false,
          );
        }
        throw new ProviderError(
          "AI 服务响应超时，请重新分析。",
          "provider_timeout",
          504,
          true,
        );
      }
      throw new ProviderError(
        "暂时无法连接 AI 服务，请检查网络后重试。",
        "provider_unavailable",
        502,
        true,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async *stream(input: GenerateInput): AsyncGenerator<string> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(input),
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          temperature: 0.2,
          max_tokens: 4_000,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderError(
          providerRejectionMessage(response.status),
          "provider_rejected",
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }
      if (!response.body) throw emptyStreamError();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let emitted = false;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            if (!emitted) throw emptyStreamError();
            return;
          }
          if (!data) continue;

          let payload: {
            choices?: Array<{ delta?: { content?: unknown } }>;
          };
          try {
            payload = JSON.parse(data) as typeof payload;
          } catch {
            throw new ProviderError(
              "AI 服务返回了无法读取的数据流，请重试。",
              "provider_protocol",
              502,
              true,
            );
          }
          const content = payload.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            emitted = true;
            yield content;
          }
        }

        if (done) break;
      }

      throw emptyStreamError();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (input.signal?.aborted && !timedOut) {
          throw new ProviderError(
            "已停止生成。",
            "provider_aborted",
            499,
            false,
          );
        }
        throw new ProviderError(
          "AI 服务响应超时，请重新分析。",
          "provider_timeout",
          504,
          true,
        );
      }
      throw new ProviderError(
        "暂时无法连接 AI 服务，请检查网络后重试。",
        "provider_unavailable",
        502,
        true,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

type ProviderMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function buildMessages(input: GenerateInput): Array<{
  role: "system" | "user";
  content: ProviderMessageContent;
}> {
  return [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: buildUserContent(input) },
  ];
}

function buildUserContent(input: GenerateInput): ProviderMessageContent {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return input.userPrompt;

  const documentText = attachments
    .filter((attachment) => attachment.kind === "document" && attachment.text)
    .map(
      (attachment) =>
        `文档：${attachment.name}\n类型：${attachment.mimeType}\n内容：\n${attachment.text}`,
    );
  const text = [
    input.userPrompt,
    documentText.length > 0
      ? `用户本轮上传的文档材料如下，请把它们当作用户提供的待核实证据读取：\n\n${documentText.join("\n\n---\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const images = attachments.filter(
    (attachment) => attachment.kind === "image" && attachment.dataUrl,
  );

  if (images.length === 0) return text;

  return [
    { type: "text", text },
    ...images.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.dataUrl ?? "" },
    })),
  ];
}

export function createDeepSeekClientFromEnv(): DeepSeekClient {
  return new DeepSeekClient({
    endpoint: process.env.DEEPSEEK_API_ENDPOINT ?? "",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    model: process.env.DEEPSEEK_MODEL ?? "",
  });
}

function providerRejectionMessage(status: number): string {
  if (status === 401) {
    return "AI 服务鉴权失败，请更新本地 API 密钥。";
  }
  if (status === 403) {
    return "AI 服务拒绝了请求，请检查密钥权限或账户额度。";
  }
  if (status === 429) {
    return "AI 服务当前请求较多，请稍后重试。";
  }
  return "AI 服务未接受本次分析请求，请稍后重试。";
}

function emptyStreamError(): ProviderError {
  return new ProviderError(
    "AI 服务返回了空结果，请重新分析。",
    "provider_protocol",
    502,
    true,
  );
}
