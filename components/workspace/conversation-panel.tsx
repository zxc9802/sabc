"use client";

import type { FormEvent, UIEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { AttachmentPicker } from "@/components/chat/attachment-picker";
import { ChatMessageContent } from "@/components/chat/chat-message-content";
import type { ChatAttachment } from "@/lib/attachments/attachment-types";
import type { InterviewDepth } from "@/lib/domain/types";
import type { MessageRecord, ProjectRecord } from "@/lib/storage/db";
import type {
  StreamDraft,
  WorkspacePhase,
} from "@/lib/workspace/workspace-reducer";

interface ConversationPanelProps {
  project: ProjectRecord | null;
  messages: MessageRecord[];
  streamDraft: StreamDraft | null;
  phase: WorkspacePhase;
  description: string;
  answer: string;
  attachments: ChatAttachment[];
  attachmentError: string | null;
  onDescriptionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onAttachmentRemove: (id: string) => void;
  onCreate: () => void;
  onAnswer: () => void;
  onStop: () => void;
  onFinalize: () => void;
  onDepthChange: (depth: InterviewDepth) => void;
}

export function ConversationPanel({
  project,
  messages,
  streamDraft,
  phase,
  description,
  answer,
  attachments,
  attachmentError,
  onDescriptionChange,
  onAnswerChange,
  onFilesSelected,
  onAttachmentRemove,
  onCreate,
  onAnswer,
  onStop,
  onFinalize,
  onDepthChange,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const previousPhaseRef = useRef(phase);
  const previousAssistantCountRef = useRef(0);
  const [completedAnnouncement, setCompletedAnnouncement] = useState("");
  const busy = !["idle", "ready", "error"].includes(phase);
  const assistantCount = messages.filter(({ role }) => role === "assistant").length;
  const canFinalize = phase === "ready" && assistantCount > 0;

  useEffect(() => {
    if (!project || !nearBottomRef.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, project, streamDraft?.content]);

  useEffect(() => {
    if (previousPhaseRef.current === "chatting" && phase === "ready") {
      answerRef.current?.focus();
    }
    previousPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (assistantCount > previousAssistantCountRef.current) {
      setCompletedAnnouncement("AI 回复已完成，可以继续补充或结束访谈。");
    }
    previousAssistantCountRef.current = assistantCount;
  }, [assistantCount]);

  if (!project) {
    return (
      <section
        className="flex min-h-[600px] flex-col bg-sheet"
        aria-labelledby="new-project-title"
      >
        <div className="border-b border-line px-5 py-5 sm:px-8 sm:py-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-decision">
            New dossier · interview first
          </p>
          <h2
            id="new-project-title"
            className="mt-2 max-w-3xl font-display text-3xl font-bold leading-tight sm:text-4xl"
          >
            先把项目问清楚，
            <span className="text-decision">最后再形成一次评级。</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            从项目目标、用户、验证数据、资源和风险开始。AI 会逐轮追问；访谈期间不评分，结束后才联网调研并生成报告。
          </p>
        </div>
        <form
          className="flex flex-1 flex-col p-5 sm:p-8"
          onSubmit={(event) => submit(event, onCreate)}
        >
          <label htmlFor="project-description" className="text-sm font-semibold">
            项目描述
          </label>
          <textarea
            id="project-description"
            className="mt-3 min-h-64 flex-1 resize-y border border-line bg-[#fbfcfe] p-4 leading-7 text-ink placeholder:text-[#7b8798] focus:border-decision"
            maxLength={20_000}
            placeholder="例如：准备做一个面向东南亚市场的跨境电商项目，目标用户是……目前已有的订单、访谈或测试数据是……"
            value={description}
            disabled={busy}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
          <AttachmentPicker
            attachments={attachments}
            busy={busy}
            error={attachmentError}
            onFilesSelected={onFilesSelected}
            onRemove={onAttachmentRemove}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted">
              本地保存 · 默认中等问答深度 · 最多 20,000 字
            </p>
            <button
              type="submit"
              className="min-h-12 min-w-36 bg-decision px-6 font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
              disabled={busy || description.trim().length === 0}
            >
              {busy ? "正在开始" : "开始访谈"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-[600px] flex-col bg-sheet"
      aria-labelledby="conversation-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-4 sm:px-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Evidence interview
          </p>
          <h2
            id="conversation-title"
            className="mt-1 font-display text-2xl font-semibold"
          >
            {project.name}
          </h2>
        </div>
        <label className="grid gap-1 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          问答深度
          <select
            aria-label="问答深度"
            className="min-h-9 border border-line bg-white px-3 font-sans text-sm font-semibold normal-case tracking-normal text-ink focus:border-decision disabled:cursor-wait disabled:opacity-60"
            value={project.interviewDepth ?? "medium"}
            disabled={busy}
            onChange={(event) =>
              onDepthChange(event.target.value as InterviewDepth)
            }
          >
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>
      </div>

      <ol
        ref={scrollRef}
        className="conversation-scroll flex-1 space-y-5 px-5 py-6 sm:px-8"
        onScroll={trackScrollPosition}
      >
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto max-w-[84%] border-r-2 border-decision bg-[#edf2ff] px-4 py-3"
                : "max-w-[86%] border-l-2 border-evidence bg-[#f1f8f5] px-4 py-3"
            }
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {message.role === "user" ? "项目方" : "AI 访谈员"} · R
              {message.round}
            </p>
            <ChatMessageContent
              className="mt-2 whitespace-pre-wrap text-sm leading-7"
              content={message.content}
            />
          </li>
        ))}

        {phase === "chatting" && !streamDraft ? (
          <li className="max-w-[86%] border-l-2 border-warning px-4 py-3 text-sm text-muted">
            <span className="analysis-pulse" aria-hidden="true" />
            AI 正在思考下一个最有价值的问题……
          </li>
        ) : null}

        {streamDraft ? (
          <li className="max-w-[86%] border-l-2 border-evidence bg-[#f1f8f5] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-evidence">
              AI 访谈员 · 生成中
            </p>
            <ChatMessageContent
              className={`mt-2 whitespace-pre-wrap text-sm leading-7 ${
                phase === "chatting" ? "stream-cursor" : ""
              }`}
              content={streamDraft.content}
              streaming={phase === "chatting"}
            />
          </li>
        ) : null}
      </ol>

      <p role="status" className="sr-only">
        {completedAnnouncement}
      </p>

      <div className="bg-[#fbfcfe] p-5 sm:p-7 sm:px-8">
        <form onSubmit={(event) => submit(event, onAnswer)}>
          <label htmlFor="conversation-answer" className="text-sm font-semibold">
            继续补充或回答
          </label>
          <textarea
            ref={answerRef}
            id="conversation-answer"
            className="mt-2 min-h-24 w-full resize-y border border-line bg-white p-3 leading-6 focus:border-decision"
            value={answer}
            disabled={busy}
            placeholder="回答 AI 的问题，或补充订单、访谈、成本、团队与风险等事实。"
            onChange={(event) => onAnswerChange(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs leading-5 text-muted">
              {phase === "chatting"
                ? "回复正在生成，文字会立即显示。"
                : busy
                  ? "当前回复尚未完成，请稍候。"
                  : "AI 的结束建议不会自动结束；你可以继续聊，也可以手动开始调研。"}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {canFinalize ? (
                <button
                  type="button"
                  className="min-h-11 border border-decision bg-white px-4 font-semibold text-decision hover:bg-decision hover:text-white"
                  onClick={onFinalize}
                >
                  结束信息收集并开始调研
                </button>
              ) : null}
              {phase === "chatting" ? (
                <button
                  type="button"
                  className="min-h-11 border border-annotation bg-white px-4 font-semibold text-annotation hover:bg-annotation hover:text-white"
                  onClick={onStop}
                >
                  停止生成
                </button>
              ) : null}
              <button
                type="submit"
                className="min-h-11 bg-ink px-5 font-semibold text-white hover:bg-decision disabled:cursor-wait disabled:opacity-60"
                disabled={busy || answer.trim().length === 0}
              >
                发送
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );

  function trackScrollPosition(event: UIEvent<HTMLOListElement>): void {
    const target = event.currentTarget;
    nearBottomRef.current =
      target.scrollHeight - target.scrollTop - target.clientHeight < 80;
  }
}

function submit(event: FormEvent, action: () => void): void {
  event.preventDefault();
  action();
}
