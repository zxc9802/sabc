"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAdvisoryMessage } from "@/lib/conversation/message-stage";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type {
  AssessmentRecord,
  MessageRecord,
  ProjectRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";

import { createAdvisorContext } from "./advisor-context";
import {
  AdvisorRequestError,
  requestAdvisorMessage,
} from "./advisor-client";
import type { AdvisorMode } from "./advisor-prompt";

export type AdvisorSessionPhase = "loading" | "ready" | "chatting" | "error";

export interface AdvisorSessionError {
  code: string;
  message: string;
  retryable: boolean;
}

interface AdvisorSessionState {
  phase: AdvisorSessionPhase;
  project: ProjectRecord | null;
  assessment: AssessmentRecord | null;
  researchSnapshot: ResearchSnapshotRecord | null;
  messages: MessageRecord[];
  streamDraft: string;
  error: AdvisorSessionError | null;
}

export function useAdvisorSession(options: {
  projectId: string;
  repository: ProjectRepository;
  fetcher?: typeof fetch;
}) {
  const { projectId, repository, fetcher = fetch } = options;
  const [state, setState] = useState<AdvisorSessionState>({
    phase: "loading",
    project: null,
    assessment: null,
    researchSnapshot: null,
    messages: [],
    streamDraft: "",
    error: null,
  });
  const projectRef = useRef<ProjectRecord | null>(null);
  const assessmentRef = useRef<AssessmentRecord | null>(null);
  const researchSnapshotRef = useRef<ResearchSnapshotRecord | null>(null);
  const messagesRef = useRef<MessageRecord[]>([]);
  const pendingRequestRef = useRef<{
    mode: AdvisorMode;
    messages: MessageRecord[];
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const runRequest = useCallback(
    async (
      mode: AdvisorMode,
      messages: MessageRecord[],
    ): Promise<boolean> => {
      const project = projectRef.current;
      const assessment = assessmentRef.current;
      if (!project || !assessment) return false;
      const requestNumber = ++requestRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setState((current) => ({
        ...current,
        phase: "chatting",
        streamDraft: "",
        error: null,
      }));

      try {
        const result = await requestAdvisorMessage({
          fetcher,
          mode,
          context: createAdvisorContext(
            project,
            assessment,
            researchSnapshotRef.current,
          ),
          messages,
          signal: controller.signal,
          onDelta(draft) {
            if (requestRef.current !== requestNumber) return;
            setState((current) => ({ ...current, streamDraft: draft }));
          },
        });
        if (requestRef.current !== requestNumber) return false;
        const assistant: MessageRecord = {
          id: result.id,
          projectId: project.id,
          role: "assistant",
          content: result.content,
          round:
            mode === "opening"
              ? 0
              : messages.filter(({ role }) => role === "user").length,
          createdAt: new Date().toISOString(),
          stage: "advisory",
          kind: "chat",
        };
        await repository.appendMessage(assistant);
        const nextMessages = [...messages, assistant];
        messagesRef.current = nextMessages;
        pendingRequestRef.current = null;
        setState((current) => ({
          ...current,
          phase: "ready",
          messages: nextMessages,
          streamDraft: "",
          error: null,
        }));
        return true;
      } catch (error) {
        if (requestRef.current !== requestNumber) return false;
        const advisorError =
          error instanceof AdvisorRequestError
            ? error
            : new AdvisorRequestError(
                "storage_failed",
                "回复未能保存到本地，请重试。",
                true,
              );
        if (advisorError.code === "aborted") {
          setState((current) => ({
            ...current,
            phase: "ready",
            streamDraft: "",
            error: null,
          }));
          return false;
        }
        pendingRequestRef.current = { mode, messages };
        setState((current) => ({
          ...current,
          phase: "ready",
          streamDraft: "",
          error: {
            code: advisorError.code,
            message: advisorError.message,
            retryable: advisorError.retryable,
          },
        }));
        return false;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [fetcher, repository],
  );

  useEffect(() => {
    let cancelled = false;
    void repository
      .getProjectWorkspace(projectId)
      .then((workspace) => {
        if (cancelled) return;
        if (!workspace) {
          setState((current) => ({
            ...current,
            phase: "error",
            error: {
              code: "not_found",
              message: "项目不存在或已被删除。",
              retryable: false,
            },
          }));
          return;
        }
        const assessment = workspace.assessments.at(-1);
        if (!assessment) {
          setState((current) => ({
            ...current,
            phase: "error",
            project: workspace.project,
            error: {
              code: "assessment_missing",
              message: "项目还没有完成调研与评级。",
              retryable: false,
            },
          }));
          return;
        }
        const messages = workspace.messages.filter(isAdvisoryMessage);
        projectRef.current = workspace.project;
        assessmentRef.current = assessment;
        researchSnapshotRef.current = workspace.researchSnapshot ?? null;
        messagesRef.current = messages;
        setState({
          phase: "ready",
          project: workspace.project,
          assessment,
          researchSnapshot: workspace.researchSnapshot ?? null,
          messages,
          streamDraft: "",
          error: null,
        });
        if (messages.length === 0) {
          void runRequest("opening", messages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            phase: "error",
            error: {
              code: "storage_failed",
              message: "无法读取本地项目，请刷新后重试。",
              retryable: true,
            },
          }));
        }
      });
    return () => {
      cancelled = true;
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [projectId, repository, runRequest]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const project = projectRef.current;
      const content = text.trim();
      if (!project || !content || state.phase !== "ready") return false;
      const userMessage: MessageRecord = {
        id: crypto.randomUUID(),
        projectId: project.id,
        role: "user",
        content,
        round: messagesRef.current.filter(({ role }) => role === "user").length + 1,
        createdAt: new Date().toISOString(),
        stage: "advisory",
        kind: "chat",
      };
      try {
        await repository.appendMessage(userMessage);
      } catch {
        setState((current) => ({
          ...current,
          error: {
            code: "storage_failed",
            message: "问题未能保存到本地，请重试。",
            retryable: true,
          },
        }));
        return false;
      }
      const messages = [...messagesRef.current, userMessage];
      messagesRef.current = messages;
      setState((current) => ({ ...current, messages }));
      return await runRequest("reply", messages);
    },
    [repository, runRequest, state.phase],
  );

  const retry = useCallback(async (): Promise<boolean> => {
    const pending = pendingRequestRef.current;
    if (!pending) return false;
    return await runRequest(pending.mode, pending.messages);
  }, [runRequest]);

  const stop = useCallback(() => {
    if (!abortRef.current) return false;
    requestRef.current += 1;
    abortRef.current.abort();
    abortRef.current = null;
    setState((current) => ({
      ...current,
      phase: "ready",
      streamDraft: "",
      error: null,
    }));
    return true;
  }, []);

  return { ...state, send, retry, stop };
}
