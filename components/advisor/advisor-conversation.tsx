import type { FormEvent } from "react";

import { AttachmentPicker } from "@/components/chat/attachment-picker";
import { ChatMessageContent } from "@/components/chat/chat-message-content";
import type { ChatAttachment } from "@/lib/attachments/attachment-types";
import type {
  MessageRecord,
  ProjectRecord,
} from "@/lib/storage/db";
import type {
  AdvisorSessionError,
  AdvisorSessionPhase,
} from "@/lib/advisor/use-advisor-session";
import type {
  FinalReportGenerationError,
  FinalReportGenerationPhase,
} from "@/lib/report/use-final-report-generation";

interface AdvisorConversationProps {
  project: ProjectRecord;
  messages: MessageRecord[];
  phase: AdvisorSessionPhase;
  streamDraft: string;
  error: AdvisorSessionError | null;
  reportPhase: FinalReportGenerationPhase;
  reportError: FinalReportGenerationError | null;
  answer: string;
  attachments: ChatAttachment[];
  attachmentError: string | null;
  onAnswerChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentRemove: (id: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onStop: () => void;
  onGenerateReport: () => void;
  onRetryReport: () => void;
}

export function AdvisorConversation({
  project,
  messages,
  phase,
  streamDraft,
  error,
  reportPhase,
  reportError,
  answer,
  attachments,
  attachmentError,
  onAnswerChange,
  onFilesSelected,
  onAttachmentRemove,
  onSend,
  onRetry,
  onStop,
  onGenerateReport,
  onRetryReport,
}: AdvisorConversationProps) {
  const busy = phase === "chatting";
  const reportBusy = reportPhase !== "idle";

  return (
    <section aria-label="项目建议智能体对话" className="min-w-0 bg-sheet">
      <div className="border-b border-line px-5 py-4 sm:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-decision">
          Stage 2 · Project advisor
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">{project.name}</h1>
      </div>

      <div className="advisor-conversation-scroll space-y-5 px-4 py-5 sm:px-7">
        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto max-w-[82%] border-r-2 border-decision bg-[#edf2ff] px-4 py-3"
                : "max-w-[86%] border-l-2 border-evidence bg-[#f1f8f5] px-4 py-3"
            }
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {message.role === "user" ? "项目方" : "项目建议智能体"}
            </p>
            <ChatMessageContent
              className="mt-2 whitespace-pre-wrap text-sm leading-7"
              content={message.content}
            />
          </article>
        ))}

        {busy && !streamDraft ? (
          <div className="max-w-[86%] border-l-2 border-warning px-4 py-3 text-sm text-muted">
            <span className="analysis-pulse" aria-hidden="true" />
            建议智能体正在核对访谈、调研与阶段评估……
          </div>
        ) : null}
        {streamDraft ? (
          <article className="max-w-[86%] border-l-2 border-evidence bg-[#f1f8f5] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-evidence">
              项目建议智能体 · 生成中
            </p>
            <ChatMessageContent
              className="stream-cursor mt-2 whitespace-pre-wrap text-sm leading-7"
              content={streamDraft}
              streaming
            />
          </article>
        ) : null}
      </div>

      <div className="advisor-composer border-t border-line bg-[#fbfcfe] p-5 sm:px-8">
        {reportError ? (
          <div role="alert" className="mb-4 border-l-2 border-annotation px-3 text-sm">
            <p>{reportError.message}</p>
            {reportError.retryable ? (
              <button
                type="button"
                className="mt-2 min-h-10 border border-annotation px-3 font-semibold text-annotation hover:bg-annotation hover:text-white"
                onClick={onRetryReport}
              >
                {reportError.code === "storage_failed" ? "重试保存" : "重新生成报告"}
              </button>
            ) : null}
          </div>
        ) : null}
        {reportBusy ? (
          <p className="mb-4 border-l-2 border-warning px-3 text-sm text-muted" aria-live="polite">
            {reportStatus(reportPhase)}
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="mb-4 border-l-2 border-annotation px-3 text-sm">
            <p>{error.message}</p>
            {error.retryable ? (
              <button
                type="button"
                className="mt-2 min-h-10 border border-annotation px-3 font-semibold text-annotation hover:bg-annotation hover:text-white"
                onClick={onRetry}
              >
                重试回复
              </button>
            ) : null}
          </div>
        ) : null}
        <form onSubmit={(event) => submit(event, onSend)}>
          <label htmlFor="advisor-answer" className="text-sm font-semibold">
            继续和建议智能体讨论
          </label>
          <textarea
            id="advisor-answer"
            className="mt-2 min-h-24 w-full resize-y border border-line bg-white p-3 leading-6 focus:border-decision"
            value={answer}
            disabled={busy}
            placeholder="例如：为什么不是 S 级？我应该先验证哪一个风险？"
            onChange={(event) => onAnswerChange(event.target.value)}
          />
          <AttachmentPicker
            attachments={attachments}
            busy={busy}
            error={attachmentError}
            onFilesSelected={onFilesSelected}
            onRemove={onAttachmentRemove}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="min-h-11 border border-decision px-5 font-semibold text-decision hover:bg-decision hover:text-white disabled:cursor-wait disabled:opacity-50"
              disabled={busy || reportBusy}
              onClick={onGenerateReport}
            >
              生成最终报告
            </button>
            {busy ? (
              <button
                type="button"
                className="min-h-11 border border-annotation px-4 font-semibold text-annotation hover:bg-annotation hover:text-white"
                onClick={onStop}
              >
                停止生成
              </button>
            ) : null}
            <button
              type="submit"
              className="min-h-11 bg-ink px-5 font-semibold text-white hover:bg-decision disabled:cursor-wait disabled:opacity-60"
              disabled={busy || reportBusy || answer.trim().length === 0}
            >
              发送
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function reportStatus(phase: FinalReportGenerationPhase): string {
  if (phase === "analyzing") return "正在综合访谈、调研和建议对话……";
  if (phase === "scoring") return "正在计算最终 SABC 评级……";
  if (phase === "saving") return "正在保存并打开最终报告……";
  return "";
}

function submit(event: FormEvent, action: () => void): void {
  event.preventDefault();
  action();
}
