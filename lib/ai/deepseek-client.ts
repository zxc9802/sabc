import "server-only";

import type { ChatAttachment } from "@/lib/attachments/attachment-types";
import {
  MainAppBillingError,
  parseOpenAiUsage,
  reserveTextCredits,
} from "@/lib/main-app-billing";

export interface GenerateResult {
  text: string;
  researchAvailable: false;
}

export type GenerateProfile = "fast_json" | "analysis_json";

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  attachments?: ChatAttachment[];
  profile?: GenerateProfile;
  operation?: string;
  signal?: AbortSignal;
}

export interface DeepSeekClientOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  billingEnabled?: boolean;
  billingUserId?: string;
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
  private readonly billingEnabled: boolean;
  private readonly billingUserId?: string;

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
    this.billingEnabled = options.billingEnabled ?? false;
    this.billingUserId = options.billingUserId;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const requestOptions = generateRequestOptions(input.profile);
    const messages = buildMessages(input);
    const estimatedInputTokens = estimateMessageTokens(messages);
    const billing = this.billingEnabled
      ? await reserveProviderCredits({
          userId: this.billingUserId,
          operation: input.operation,
          model: this.model,
          estimatedInputTokens,
          maxOutputTokens: requestOptions.max_tokens,
        })
      : null;

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...requestOptions,
          response_format: { type: "json_object" },
          temperature: 0.2,
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
        usage?: unknown;
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

      await billing?.settle(parseOpenAiUsage(payload, {
        inputTokens: estimatedInputTokens,
        outputText: content,
      }));
      logGenerateTiming(input, startedAt, "completed");
      return { text: content.trim(), researchAvailable: false };
    } catch (error) {
      let providerError: ProviderError;
      if (!(error instanceof MainAppBillingError)) {
        await billing?.release().catch(() => undefined);
      }
      if (error instanceof ProviderError) {
        providerError = error;
      } else if (error instanceof MainAppBillingError) {
        providerError = new ProviderError(
          error.message,
          error.code || "credit_billing",
          error.status,
          error.status >= 500,
        );
      } else if (error instanceof DOMException && error.name === "AbortError") {
        if (input.signal?.aborted && !timedOut) {
          providerError = new ProviderError(
            "已停止生成。",
            "provider_aborted",
            499,
            false,
          );
        } else {
          providerError = new ProviderError(
            "AI 服务响应超时，请重新分析。",
            "provider_timeout",
            504,
            true,
          );
        }
      } else {
        providerError = new ProviderError(
          "暂时无法连接 AI 服务，请检查网络后重试。",
          "provider_unavailable",
          502,
          true,
        );
      }
      logGenerateTiming(input, startedAt, "failed", providerError.code);
      throw providerError;
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
    const messages = buildMessages(input);
    const estimatedInputTokens = estimateMessageTokens(messages);
    const billing = this.billingEnabled
      ? await reserveProviderCredits({
          userId: this.billingUserId,
          operation: input.operation,
          model: this.model,
          estimatedInputTokens,
          maxOutputTokens: 4_000,
        })
      : null;
    let outputText = "";
    let preserveReservation = false;

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
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
            await billing?.settle(parseOpenAiUsage({}, {
              inputTokens: estimatedInputTokens,
              outputText,
            }));
            return;
          }
          if (!data) continue;

          let payload: {
            choices?: Array<{ delta?: { content?: unknown } }>;
            usage?: unknown;
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
            outputText += content;
            yield content;
          }
          if (payload.usage) {
            await billing?.settle(parseOpenAiUsage(payload, {
              inputTokens: estimatedInputTokens,
              outputText,
            }));
          }
        }

        if (done) break;
      }

      throw emptyStreamError();
    } catch (error) {
      let handledError = error;
      if (!(handledError instanceof MainAppBillingError) && outputText && billing) {
        try {
          await billing.settle(parseOpenAiUsage({}, {
            inputTokens: estimatedInputTokens,
            outputText,
          }));
        } catch (settlementError) {
          handledError = settlementError;
        }
      }
      if (handledError instanceof ProviderError) throw handledError;
      if (handledError instanceof MainAppBillingError) {
        preserveReservation = true;
        throw new ProviderError(
          handledError.message,
          handledError.code || "credit_billing",
          handledError.status,
          handledError.status >= 500,
        );
      }
      if (handledError instanceof DOMException && handledError.name === "AbortError") {
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
      if (!preserveReservation && outputText && billing) {
        try {
          await billing.settle(parseOpenAiUsage({}, {
            inputTokens: estimatedInputTokens,
            outputText,
          }));
        } catch (error) {
          preserveReservation = error instanceof MainAppBillingError;
        }
      }
      if (!preserveReservation) {
        await billing?.release().catch(() => undefined);
      }
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function generateRequestOptions(profile?: GenerateProfile): {
  thinking?: { type: "enabled" };
  reasoning_effort?: "high";
  max_tokens: number;
} {
  if (profile === "fast_json") return { max_tokens: 2_000 };
  if (profile === "analysis_json") {
    return {
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      max_tokens: 8_000,
    };
  }
  return {
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    max_tokens: 12_000,
  };
}

function logGenerateTiming(
  input: GenerateInput,
  startedAt: number,
  status: "completed" | "failed",
  code?: string,
): void {
  console.info("[sabc.ai.timing]", {
    operation: input.operation ?? "generate",
    profile: input.profile ?? "default",
    durationMs: Date.now() - startedAt,
    status,
    ...(code ? { code } : {}),
  });
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

function normalizeOperation(value: string | undefined): string {
  const normalized = (value || "generate")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "generate";
}

function estimateMessageTokens(messages: ReturnType<typeof buildMessages>): number {
  const serialized = JSON.stringify(messages, (_key, value) => (
    typeof value === "string" && value.startsWith("data:")
      ? `[attachment:${value.length}]`
      : value
  ));
  return Math.min(200_000, new TextEncoder().encode(serialized).length);
}

async function reserveProviderCredits(input: {
  userId?: string;
  operation?: string;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}) {
  try {
    return await reserveTextCredits({
      userId: input.userId,
      operation: normalizeOperation(input.operation),
      model: input.model,
      estimatedInputTokens: input.estimatedInputTokens,
      maxOutputTokens: input.maxOutputTokens,
    });
  } catch (error) {
    if (error instanceof MainAppBillingError) {
      throw new ProviderError(
        error.message,
        error.code || "credit_billing",
        error.status,
        error.status >= 500,
      );
    }
    throw error;
  }
}

export function createDeepSeekClientFromEnv(billingUserId?: string): DeepSeekClient {
  return new DeepSeekClient({
    endpoint: process.env.DEEPSEEK_API_ENDPOINT ?? "",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    model: process.env.DEEPSEEK_MODEL ?? "",
    billingEnabled: true,
    billingUserId,
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
