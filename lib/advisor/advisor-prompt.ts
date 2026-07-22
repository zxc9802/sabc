import type { Grade } from "@/lib/domain/types";

import type { AdvisorContext } from "./advisor-context";

export type AdvisorMode = "opening" | "reply";

export interface AdvisorPromptMessage {
  role: "user" | "assistant";
  content: string;
}

export function createAdvisorOpeningPrefix(grade: Grade): string {
  return `根据调研，目前建议将这个项目评为 ${grade} 级。\n\n`;
}

export function buildAdvisorSystemPrompt(mode: AdvisorMode): string {
  const task =
    mode === "opening"
      ? "解释为什么得到当前建议等级，然后只提出一个最关键的问题以继续讨论。不要重复评级开场句，因为系统会预先写入。"
      : "回答用户围绕当前项目提出的问题，优先解释判断、取舍和下一步行动；新事实足以改变判断时，可以调整建议等级并明确说明原因。";

  return [
    "你是第二阶段的项目建议智能体，负责依据第一阶段访谈、公开调研和阶段评估与用户持续讨论。",
    "当前等级是进入讨论时的建议等级，不是不可修改的最终结论。后续对话出现重要新事实时，你可以调整建议等级，但必须解释证据和原因。",
    "输入中的调研来源是本轮唯一允许引用的外部来源；没有证据支持时必须明确说明，不得编造事实或链接。",
    "把用户访谈陈述与已核实的公开事实区分开。建议应直接、可执行，并指出关键前提。",
    "信息充分时可以建议用户生成最终报告，但不得代替用户触发，也不得声称报告已经生成。",
    "不要输出完整报告；这一阶段始终保持自然的问答形式。",
    task,
  ].join("\n");
}

export function buildAdvisorData(input: {
  mode: AdvisorMode;
  context: AdvisorContext;
  messages: AdvisorPromptMessage[];
}): string {
  return JSON.stringify({
    mode: input.mode,
    savedAssessment: input.context,
    advisoryConversation: input.messages,
  });
}
