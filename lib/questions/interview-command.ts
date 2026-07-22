export type InterviewCommand = "skip" | "finish";

export function detectInterviewCommand(text: string): InterviewCommand | null {
  const normalized = text.trim().replace(/[。！!？?]+$/u, "");
  if (/^(跳过|这题跳过|暂时无法提供)$/u.test(normalized)) return "skip";
  if (/^(结束评估|完成评估|生成当前结论)$/u.test(normalized)) return "finish";
  return null;
}
