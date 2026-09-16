import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import {
  getMainAppSessionCookieName,
  getMainAppUrl,
  readMainAppSessionCookie,
} from "@/lib/main-app-sso";

export type MainAppTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export class MainAppBillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MainAppBillingError";
  }
}

function requiredValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MainAppBillingError(`${name} is not configured.`, 503, "billing_config");
  }
  return value;
}

export async function currentBillingUserId() {
  if (process.env.VITEST) return "test-user";
  const cookieStore = await cookies();
  const session = await readMainAppSessionCookie(
    cookieStore.get(getMainAppSessionCookieName())?.value,
  );
  if (!session) throw new MainAppBillingError("主站登录状态已失效。", 401, "sso_session");
  return session.user.id;
}

async function postBilling(userId: string, body: Record<string, unknown>) {
  const response = await fetch(`${getMainAppUrl()}/api/sso/billing`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-qycm-sso-client-secret": requiredValue("MAIN_APP_SSO_CLIENT_SECRET"),
    },
    body: JSON.stringify({
      product: "sabc",
      userId,
      ...body,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
    };
    throw new MainAppBillingError(
      payload.error || `主站积分服务请求失败：${response.status}`,
      response.status,
      payload.code,
    );
  }
}

export async function reserveTextCredits(input: {
  userId?: string;
  operation: string;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}) {
  if (process.env.VITEST) {
    return {
      settle: async (_usage: MainAppTokenUsage) => undefined,
      release: async () => undefined,
    };
  }
  const userId = input.userId || await currentBillingUserId();
  const requestId = randomUUID();
  const common = {
    requestId,
    operation: input.operation,
    model: input.model,
    providerId: "yunwu",
  };
  await postBilling(userId, {
    action: "reserve",
    ...common,
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: input.maxOutputTokens,
  });
  let completed = false;
  return {
    async settle(usage: MainAppTokenUsage) {
      if (completed) return;
      await postBilling(userId, { action: "settle", ...common, usage });
      completed = true;
    },
    async release() {
      if (completed) return;
      await postBilling(userId, { action: "release", ...common });
      completed = true;
    },
  };
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseOpenAiUsage(
  payload: unknown,
  fallback: { inputTokens: number; outputText: string },
): MainAppTokenUsage {
  const usage = record(record(payload).usage);
  const inputTokens = positiveInteger(usage.prompt_tokens ?? usage.input_tokens)
    || fallback.inputTokens;
  const cachedInputTokens = Math.min(
    inputTokens,
    positiveInteger(record(usage.prompt_tokens_details).cached_tokens),
  );
  const reasoningTokens = positiveInteger(
    record(usage.completion_tokens_details).reasoning_tokens,
  );
  const outputTokens = positiveInteger(usage.completion_tokens ?? usage.output_tokens)
    || Math.max(1, new TextEncoder().encode(fallback.outputText).length);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: positiveInteger(usage.total_tokens) || inputTokens + outputTokens,
  };
}
