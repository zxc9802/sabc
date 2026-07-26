import "server-only";

import { z } from "zod";

import type {
  GenerateProfile,
  GenerateResult,
} from "@/lib/ai/deepseek-client";

import { sanitizeResearchQueries } from "./query-sanitizer";

const researchPlanSchema = z.strictObject({
  queries: z.array(z.string()).min(1).max(5),
});

interface ResearchPlanningClient {
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    profile?: GenerateProfile;
    operation?: string;
    signal?: AbortSignal;
  }): Promise<GenerateResult>;
}

interface ResearchPlanningInput {
  projectDescription: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    round: number;
  }>;
  signal?: AbortSignal;
}

export async function createResearchPlan(
  client: ResearchPlanningClient,
  input: ResearchPlanningInput,
): Promise<{ queries: string[] }> {
  const systemPrompt = `你负责把项目访谈转换为公开网络调研语句。

只返回严格 JSON：{"queries":["公开搜索语句"]}。
生成 1 到 3 条独立、具体、可公开检索的语句，优先覆盖市场需求、竞争与政策成本风险。
不得复制 API Key、密码、邮箱、电话、内部订单号、内部客户名或内部金额。
不得输出完整访谈摘要、Markdown、解释或额外字段。`;
  const userPrompt = JSON.stringify({
    projectDescription: input.projectDescription,
    conversation: input.messages,
  });

  let previous = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.generate({
      systemPrompt:
        attempt === 0
          ? systemPrompt
          : `${systemPrompt}\n上一次输出未通过结构校验，请只返回合法 JSON。`,
      userPrompt:
        attempt === 0
          ? userPrompt
          : JSON.stringify({ conversation: userPrompt, invalidOutput: previous }),
      profile: "fast_json",
      operation: attempt === 0 ? "research_plan" : "research_plan_repair",
      signal: input.signal,
    });
    previous = response.text.slice(0, 2_000);
    try {
      const parsed = researchPlanSchema.parse(JSON.parse(response.text) as unknown);
      const queries = sanitizeResearchQueries(parsed.queries).slice(0, 3);
      if (queries.length > 0) return { queries };
    } catch {
      // One repair attempt is allowed below.
    }
  }

  throw new ResearchPlanError();
}

export class ResearchPlanError extends Error {
  readonly code = "research_plan_invalid";

  constructor() {
    super("AI 未能生成安全、可用的公开调研语句，请重试。");
    this.name = "ResearchPlanError";
  }
}
