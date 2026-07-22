import type { MessageRecord } from "@/lib/storage/db";

export function isInterviewMessage(message: MessageRecord): boolean {
  return message.stage !== "advisory";
}

export function isAdvisoryMessage(message: MessageRecord): boolean {
  return message.stage === "advisory";
}

export function isAdvisorSummary(message: MessageRecord): boolean {
  return isAdvisoryMessage(message) && message.kind === "advisor_summary";
}
