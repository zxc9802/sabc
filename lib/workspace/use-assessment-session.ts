"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { InterviewDepth } from "@/lib/domain/types";
import { isInterviewMessage } from "@/lib/conversation/message-stage";
import type {
  AssessmentRecord,
  MessageRecord,
  ProjectRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import {
  readChatStream,
  type ChatStreamEvent,
} from "@/lib/streaming/chat-stream";
import {
  readFinalizeStream,
  type FinalizeStreamEvent,
} from "@/lib/streaming/finalize-stream";

import {
  createInitialWorkspaceState,
  workspaceReducer,
  type WorkspaceError,
  type WorkspacePhase,
} from "./workspace-reducer";

export interface UseAssessmentSessionOptions {
  repository: ProjectRepository;
  fetcher?: typeof fetch;
}

interface ChatSubmission {
  project: ProjectRecord;
  messages: MessageRecord[];
  round: number;
}

type ResearchMode = "auto" | "interview_only";

type PendingSave =
  | { kind: "message"; message: MessageRecord }
  | {
      kind: "assessment";
      assessment: AssessmentRecord;
    };

export function useAssessmentSession({
  repository,
  fetcher = fetch,
}: UseAssessmentSessionOptions) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const stateRef = useRef(state);
  const requestNumberRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stoppedRequestRef = useRef<string | null>(null);
  const lastChatSubmissionRef = useRef<ChatSubmission | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshProjects = useCallback(async () => {
    setProjects(await repository.listProjects());
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    void repository
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const cancelActiveRequest = useCallback(() => {
    requestNumberRef.current += 1;
    stoppedRequestRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const runChat = useCallback(
    async (submission: ChatSubmission): Promise<boolean> => {
      lastChatSubmissionRef.current = submission;
      const requestNumber = ++requestNumberRef.current;
      const requestId = `chat-${requestNumber}`;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      stoppedRequestRef.current = null;
      dispatch({
        type: "CHAT_STARTED",
        requestId,
        messages: submission.messages,
      });

      let streamedContent = "";
      let streamedMessageId = "";
      let completed = false;
      const isCurrentRequest = () => requestNumberRef.current === requestNumber;

      const saveAssistantMessage = async (
        messageId: string,
        content: string,
        stopped: boolean,
      ) => {
        if (completed) return;
        completed = true;
        const message: MessageRecord = {
          id: messageId || crypto.randomUUID(),
          projectId: submission.project.id,
          role: "assistant",
          content,
          round: submission.round,
          createdAt: new Date().toISOString(),
          stage: "interview",
          kind: "chat",
        };
        dispatch({
          type: stopped ? "STREAM_STOPPED" : "STREAM_COMPLETED",
          requestId,
          message,
        });
        try {
          await repository.appendMessage(message);
          pendingSaveRef.current = null;
        } catch {
          pendingSaveRef.current = { kind: "message", message };
          dispatch({
            type: "SAVE_FAILED",
            error: storageError(
              "回复已经生成，但未能保存到本地。请重试保存。",
              "retry_save",
            ),
          });
        }
      };

      try {
        let response: Response;
        try {
          response = await fetcher("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: submission.project.id,
              projectDescription: submission.project.description,
              messages: submission.messages.filter(isInterviewMessage).map(
                ({ id, role, content, round }) => ({ id, role, content, round }),
              ),
              interviewDepth: submission.project.interviewDepth ?? "medium",
              round: submission.round,
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new SessionRequestError({
            code: "network_error",
            message: "网络连接失败，请检查连接后重试。",
            retryable: true,
            action: "retry_chat",
          });
        }

        if (!response.ok) {
          throw new SessionRequestError(
            await readApiError(response, "retry_chat", "聊天请求失败，请重试。"),
          );
        }

        await readChatStream(response, async (event: ChatStreamEvent) => {
          if (!isCurrentRequest()) return;
          switch (event.type) {
            case "assistant_delta":
              streamedMessageId = event.messageId;
              streamedContent += event.delta;
              dispatch({
                type: "STREAM_DELTA",
                requestId,
                messageId: event.messageId,
                delta: event.delta,
                round: submission.round,
              });
              return;
            case "complete":
              streamedMessageId = event.messageId;
              streamedContent = event.content;
              await saveAssistantMessage(event.messageId, event.content, false);
              return;
            case "error":
              throw new SessionRequestError({
                code: event.code,
                message: event.message,
                retryable: event.retryable,
                action: event.retryable ? "retry_chat" : undefined,
              });
          }
        });

        if (!isCurrentRequest()) return false;
        if (!completed) {
          throw new SessionRequestError({
            code: "invalid_response",
            message: "聊天服务没有返回完整回复，请重试。",
            retryable: true,
            action: "retry_chat",
          });
        }
        await refreshProjects().catch(() => undefined);
        return true;
      } catch (error) {
        if (!isCurrentRequest()) return false;
        const stopped =
          stoppedRequestRef.current === requestId && isAbortError(error);
        if (stopped) {
          await saveAssistantMessage(
            streamedMessageId,
            `${streamedContent}${streamedContent ? "\n\n" : ""}（已停止生成）`,
            true,
          );
          await refreshProjects().catch(() => undefined);
          return true;
        }

        dispatch({
          type: "REQUEST_FAILED",
          requestId,
          error:
            error instanceof SessionRequestError
              ? error.workspaceError
              : {
                  code: "invalid_response",
                  message: "聊天服务返回了无法读取的结果，请重试。",
                  retryable: true,
                  action: "retry_chat",
                },
        });
        return false;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (stoppedRequestRef.current === requestId) {
          stoppedRequestRef.current = null;
        }
      }
    },
    [fetcher, refreshProjects, repository],
  );

  const loadProject = useCallback(
    async (projectId: string) => {
      cancelActiveRequest();
      dispatch({ type: "LOAD_STARTED" });
      try {
        const workspace = await repository.getProjectWorkspace(projectId);
        if (!workspace) {
          dispatch({
            type: "LOAD_FAILED",
            error: {
              code: "not_found",
              message: "项目不存在或已被删除。",
              retryable: false,
            },
          });
          return;
        }
        dispatch({ type: "LOAD_SUCCEEDED", workspace });
      } catch {
        dispatch({
          type: "LOAD_FAILED",
          error: storageError("无法读取本地项目，请重试。"),
        });
      }
    },
    [cancelActiveRequest, repository],
  );

  const createAndAnalyze = useCallback(
    async (description: string): Promise<boolean> => {
      cancelActiveRequest();
      dispatch({ type: "LOAD_STARTED" });
      try {
        const project = await repository.createProject(description);
        const message: MessageRecord = {
          id: crypto.randomUUID(),
          projectId: project.id,
          role: "user",
          content: description,
          round: 0,
          createdAt: new Date().toISOString(),
          stage: "interview",
          kind: "chat",
        };
        await repository.appendMessage(message);
        dispatch({
          type: "LOAD_SUCCEEDED",
          workspace: {
            project,
            messages: [message],
            assessments: [],
            researchSnapshot: null,
            report: null,
          },
        });
        return await runChat({ project, messages: [message], round: 0 });
      } catch {
        dispatch({
          type: "LOAD_FAILED",
          error: storageError("无法创建或保存项目，请重试。"),
        });
        return false;
      }
    },
    [cancelActiveRequest, repository, runChat],
  );

  const answerQuestion = useCallback(
    async (answerText: string): Promise<boolean> => {
      const current = stateRef.current;
      if (!current.project || isBusy(current.phase)) return false;
      const project = current.project;

      const interviewMessages = current.messages.filter(isInterviewMessage);
      const round = interviewMessages.filter(({ role }) => role === "user").length;
      const message: MessageRecord = {
        id: crypto.randomUUID(),
        projectId: project.id,
        role: "user",
        content: answerText,
        round,
        createdAt: new Date().toISOString(),
        stage: "interview",
        kind: "chat",
      };
      try {
        await repository.appendMessage(message);
      } catch {
        dispatch({
          type: "SAVE_FAILED",
          error: storageError("回答未能保存到本地，请重试。"),
        });
        return false;
      }

      return await runChat({
        project,
        messages: [...interviewMessages, message],
        round,
      });
    },
    [repository, runChat],
  );

  const finalizeCurrent = useCallback(
    async (researchMode: ResearchMode = "auto"): Promise<boolean> => {
      const current = stateRef.current;
      if (!current.project || isBusy(current.phase)) return false;
      const project = current.project;

      const requestNumber = ++requestNumberRef.current;
      const requestId = `finalize-${requestNumber}`;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      dispatch({ type: "FINALIZE_STARTED", requestId });

      let assessment: AssessmentRecord | null = null;
      let completed = false;
      const isCurrentRequest = () => requestNumberRef.current === requestNumber;

      try {
        let response: Response;
        try {
          response = await fetcher("/api/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: project.id,
              projectDescription: project.description,
              messages: current.messages.filter(isInterviewMessage).map(
                ({ id, role, content, round }) => ({ id, role, content, round }),
              ),
              interviewDepth: project.interviewDepth ?? "medium",
              round: Math.max(
                0,
                ...current.messages.filter(isInterviewMessage).map(({ round }) => round),
              ),
              researchMode,
              ...(current.researchSnapshot
                ? { researchSnapshot: current.researchSnapshot }
                : {}),
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new SessionRequestError({
            code: "network_error",
            message: "最终分析连接失败，请检查网络后重试。",
            retryable: true,
            action: "retry_finalize",
          });
        }

        if (!response.ok) {
          throw new SessionRequestError(
            await readApiError(
              response,
              "retry_finalize",
              "最终分析请求失败，请重试。",
            ),
          );
        }

        await readFinalizeStream(
          response,
          async (event: FinalizeStreamEvent) => {
            if (!isCurrentRequest()) return;
            switch (event.type) {
              case "status":
                dispatch({
                  type: "FINALIZE_STATUS",
                  requestId,
                  stage: event.stage,
                });
                return;
              case "research_plan":
                dispatch({
                  type: "RESEARCH_PLANNED",
                  requestId,
                  queries: event.queries,
                });
                return;
              case "research_complete":
                dispatch({
                  type: "RESEARCH_RECEIVED",
                  requestId,
                  snapshot: event.snapshot,
                });
                try {
                  await repository.saveResearchSnapshot(event.snapshot);
                } catch {
                  throw new SessionRequestError({
                    code: "storage_failed",
                    message: "调研结果未能保存到本地，请重试结束访谈。",
                    retryable: true,
                    action: "retry_finalize",
                  });
                }
                return;
              case "assessment": {
                if (assessment) return;
                const value: AnalyzeProjectResponse = event.result;
                assessment = {
                  id: crypto.randomUUID(),
                  projectId: project.id,
                  promptVersion: value.promptVersion,
                  sources: value.sources,
                  researchStatus: value.researchStatus,
                  analysis: value.analysis,
                  scored: value.scored,
                  nextQuestion: null,
                  diff: value.diff,
                  createdAt: new Date().toISOString(),
                };
                dispatch({
                  type: "ASSESSMENT_RECEIVED",
                  requestId,
                  assessment,
                });
                return;
              }
              case "complete":
                completed = true;
                return;
              case "error":
                throw new SessionRequestError({
                  code: event.code,
                  message: event.message,
                  retryable: event.retryable,
                  action: event.retryable ? "retry_finalize" : undefined,
                });
            }
          },
        );

        if (!isCurrentRequest()) return false;
        if (!completed) {
          throw new SessionRequestError({
            code: "invalid_response",
            message: "最终分析没有返回完整结果，请重试。",
            retryable: true,
            action: "retry_finalize",
          });
        }
        const finalAssessment = requireAssessment(assessment);

        dispatch({ type: "FINALIZATION_SAVE_STARTED", requestId });
        try {
          await repository.saveAssessment(finalAssessment);
        } catch {
          pendingSaveRef.current = {
            kind: "assessment",
            assessment: finalAssessment,
          };
          dispatch({
            type: "SAVE_FAILED",
            error: storageError(
              "最终结果已经生成，但未能保存到本地。请重试保存。",
              "retry_save",
            ),
          });
          return false;
        }

        pendingSaveRef.current = null;
        dispatch({ type: "SAVE_SUCCEEDED" });
        await refreshProjects().catch(() => undefined);
        return true;
      } catch (error) {
        if (!isCurrentRequest()) return false;
        dispatch({
          type: "REQUEST_FAILED",
          requestId,
          error:
            error instanceof SessionRequestError
              ? error.workspaceError
              : {
                  code: "invalid_response",
                  message: "最终分析服务返回了无法读取的结果，请重试。",
                  retryable: true,
                  action: "retry_finalize",
                },
        });
        return false;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [fetcher, refreshProjects, repository],
  );

  const retry = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (isBusy(current.phase)) return false;
    if (current.error?.action === "retry_finalize") {
      return await finalizeCurrent();
    }
    if (current.error?.action === "retry_chat" && lastChatSubmissionRef.current) {
      return await runChat(lastChatSubmissionRef.current);
    }
    return false;
  }, [finalizeCurrent, runChat]);

  const stopGeneration = useCallback((): boolean => {
    const current = stateRef.current;
    if (current.phase !== "chatting" || !current.activeRequestId) return false;
    stoppedRequestRef.current = current.activeRequestId;
    abortControllerRef.current?.abort();
    return true;
  }, []);

  const setInterviewDepth = useCallback(
    async (depth: InterviewDepth): Promise<boolean> => {
      const current = stateRef.current;
      if (!current.project || isBusy(current.phase)) return false;
      try {
        const project = await repository.updateInterviewDepth(
          current.project.id,
          depth,
        );
        dispatch({ type: "PROJECT_DEPTH_CHANGED", project });
        await refreshProjects().catch(() => undefined);
        return true;
      } catch {
        dispatch({
          type: "SAVE_FAILED",
          error: storageError("问答深度未能保存，请重试。"),
        });
        return false;
      }
    },
    [refreshProjects, repository],
  );

  const retrySave = useCallback(async (): Promise<"assessment" | "report" | false> => {
    const pending = pendingSaveRef.current;
    if (!pending) return false;

    try {
      if (pending.kind === "message") {
        await repository.appendMessage(pending.message);
        pendingSaveRef.current = null;
        dispatch({ type: "SAVE_SUCCEEDED" });
        await refreshProjects().catch(() => undefined);
        return "assessment";
      }

      await repository.saveAssessment(pending.assessment);
      pendingSaveRef.current = null;
      dispatch({ type: "SAVE_SUCCEEDED" });
      await refreshProjects().catch(() => undefined);
      return "assessment";
    } catch {
      dispatch({
        type: "SAVE_FAILED",
        error: storageError(
          "本地保存仍未成功，请检查浏览器存储空间后重试。",
          "retry_save",
        ),
      });
      return false;
    }
  }, [refreshProjects, repository]);

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        if (stateRef.current.project?.id === projectId) cancelActiveRequest();
        await repository.deleteProject(projectId);
        if (stateRef.current.project?.id === projectId) dispatch({ type: "RESET" });
        await refreshProjects();
      } catch {
        dispatch({
          type: "SAVE_FAILED",
          error: storageError("项目未能删除，请重试。"),
        });
      }
    },
    [cancelActiveRequest, refreshProjects, repository],
  );

  const resetSession = useCallback(() => {
    cancelActiveRequest();
    lastChatSubmissionRef.current = null;
    pendingSaveRef.current = null;
    dispatch({ type: "RESET" });
  }, [cancelActiveRequest]);

  return {
    state,
    projects,
    refreshProjects,
    loadProject,
    createAndAnalyze,
    answerQuestion,
    retry,
    retrySave,
    stopGeneration,
    setInterviewDepth,
    finalizeCurrent,
    deleteProject,
    resetSession,
  };
}

function isBusy(phase: WorkspacePhase): boolean {
  return !["idle", "ready", "error"].includes(phase);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function readApiError(
  response: Response,
  action: NonNullable<WorkspaceError["action"]>,
  fallbackMessage: string,
): Promise<WorkspaceError> {
  try {
    const body = (await response.json()) as Partial<WorkspaceError>;
    const retryable = body.retryable ?? true;
    return {
      code: body.code ?? "request_failed",
      message: body.message ?? fallbackMessage,
      retryable,
      action: retryable ? action : undefined,
    };
  } catch {
    return {
      code: "request_failed",
      message: fallbackMessage,
      retryable: true,
      action,
    };
  }
}

class SessionRequestError extends Error {
  constructor(public readonly workspaceError: WorkspaceError) {
    super(workspaceError.message);
    this.name = "SessionRequestError";
  }
}

function requireAssessment(
  assessment: AssessmentRecord | null,
): AssessmentRecord {
  if (!assessment) {
    throw new SessionRequestError({
      code: "invalid_response",
      message: "最终分析没有返回评分结果，请重试。",
      retryable: true,
      action: "retry_finalize",
    });
  }
  return assessment;
}

function storageError(
  message: string,
  action?: WorkspaceError["action"],
): WorkspaceError {
  return { code: "storage_failed", message, retryable: action !== undefined, action };
}
