# SABC Streaming Chat Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing form-like assessment loop into a persistent Chinese chat that streams the model's explanation as it is generated, supports low/medium/high interview depth, and keeps deterministic scoring authoritative.

**Architecture:** Keep the current structured assessment as phase one, then make a second provider call that streams only the human-readable explanation. The server appends the one deterministically selected question, publishes typed SSE events, and the client reducer applies assessment and text deltas separately while IndexedDB remains the source of local persistence.

**Tech Stack:** Next.js 16.2 Route Handlers and Web Streams, React 19, TypeScript 5, Zod 4, Dexie 4, Vitest 4, Testing Library, Playwright, OpenAI-compatible Chat Completions.

---

## Implementation locks

- Work in `D:\SABC智能体新`; do not copy or recreate the project.
- Before editing the route, re-read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and the “Streaming in Route Handlers” plus “HTTP contract” sections of `node_modules/next/dist/docs/01-app/02-guides/streaming.md`.
- Keep `DEEPSEEK_API_ENDPOINT`, `DEEPSEEK_MODEL`, and `DEEPSEEK_API_KEY` server-only. Do not print the configured key, provider response body, project text, or reasoning content.
- Preserve the existing seven-dimension rubric, scoring weights, grade gates, confidence rules, and veto rules.
- The provider generates the explanation only. The TypeScript selector chooses the only question, and the server appends that exact prompt after the streamed explanation.
- Keep all messages in IndexedDB. Remove the six-round and thirty-message product limits; `round` remains an ordering value, not a stopping rule.
- Default interview depth is `medium`. A depth change is persisted on the current project and affects the next submission.
- Use tests first for every task and stage only the files listed for that task.
- Do not change `.env.local`; it already contains the ignored runtime configuration.

## Locked file map

### New files

- `lib/streaming/analyze-stream.ts` — shared typed SSE encoder and incremental browser parser.
- `lib/streaming/analyze-stream.test.ts` — split-chunk, merged-chunk, Chinese UTF-8, and invalid-event coverage.
- `lib/conversation/assistant-reply.ts` — conversation prompt data and deterministic fallback/stop reply construction.
- `lib/conversation/assistant-reply.test.ts` — exact-question and fallback behavior.
- `lib/questions/interview-command.ts` — recognizes only explicit skip and finish commands.
- `lib/questions/interview-command.test.ts` — prevents ordinary answers from being mistaken for commands.
- `scripts/smoke-stream.mjs` — secret-safe live provider streaming check that reports counts and timing only.

### Modified files

- `lib/domain/types.ts` — add `InterviewDepth` and compact question-history types.
- `lib/domain/api-types.ts` — add `AnalyzeStreamEvent` discriminated union.
- `lib/storage/db.ts` — persist optional `interviewDepth` for backward-compatible records.
- `lib/storage/project-repository.ts` — create projects at medium depth and update depth without a schema/index migration.
- `lib/storage/project-repository.test.ts` — verify default, update, and reload behavior.
- `lib/questions/select-next-question.ts` — replace round cap with depth-aware evidence-chain selection.
- `lib/questions/select-next-question.test.ts` — cover low, medium, high, skip, and post-six-round behavior.
- `lib/ai/system-prompt.ts` — include depth policy in structured analysis and add the explanation-only prompt.
- `lib/ai/system-prompt.test.ts` — verify prompt boundaries and no-question contract.
- `lib/ai/deepseek-client.ts` — add provider streaming while ignoring reasoning deltas.
- `lib/ai/deepseek-client.test.ts` — cover upstream SSE parsing, aborts, empty streams, and safe errors.
- `lib/assessment/analyze-project.ts` — accept depth/question history, remove message/round stops, and apply explicit skip/finish commands.
- `lib/assessment/analyze-project.test.ts` — verify selection and unlimited-round orchestration.
- `app/api/analyze/route.ts` — validate before streaming and emit status, assessment, delta, complete, or error events.
- `app/api/analyze/route.test.ts` — verify event order, real chunk forwarding, fallback, and pre-stream HTTP errors.
- `lib/workspace/workspace-reducer.ts` — represent `assessing`, `composing`, and a stream draft.
- `lib/workspace/workspace-reducer.test.ts` — verify active-request filtering and progressive state transitions.
- `lib/workspace/use-assessment-session.ts` — consume the stream, persist assessment/message stages, stop generation, and update depth.
- `lib/workspace/use-assessment-session.test.tsx` — verify progressive deltas, stop, fallback, retry, and persistence.
- `components/workspace/conversation-panel.tsx` — replace the separate follow-up form with one pinned chat composer and depth selector.
- `components/workspace/project-workspace.tsx` — wire stream phase, draft, stop, and depth actions.
- `components/workspace/project-workspace.test.tsx` — verify the visible chat experience.
- `components/workspace/assessment-panel.tsx` — highlight dimensions changed by the current assessment.
- `app/globals.css` — add restrained stream cursor, changed-dimension highlight, and scroll-container styles.
- `e2e/assessment-flow.spec.ts` — serve typed SSE fixtures and exercise create/refine/restore/report/compare.
- `package.json` — add `smoke:stream`.
- `README.md` — document depth behavior, streaming verification, and the server-only key boundary.

## Task 1: Persist interview depth and recognize explicit interview commands

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/storage/db.ts`
- Modify: `lib/storage/project-repository.ts`
- Test: `lib/storage/project-repository.test.ts`
- Modify: `lib/workspace/use-assessment-session.test.tsx`
- Modify: `components/workspace/project-workspace.test.tsx`
- Create: `lib/questions/interview-command.ts`
- Create: `lib/questions/interview-command.test.ts`

- [ ] **Step 1: Write failing repository and command tests**

Add these focused tests:

```ts
it("creates projects with medium interview depth and persists changes", async () => {
  const project = await repository.createProject("depth test");
  expect(project.interviewDepth).toBe("medium");

  await repository.updateInterviewDepth(project.id, "high");
  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.project.interviewDepth).toBe("high");
});
```

```ts
import { describe, expect, it } from "vitest";
import { detectInterviewCommand } from "./interview-command";

describe("detectInterviewCommand", () => {
  it.each(["跳过", "这题跳过", "暂时无法提供"]) (
    "recognizes an explicit skip: %s",
    (text) => expect(detectInterviewCommand(text)).toBe("skip"),
  );

  it.each(["结束评估", "完成评估", "生成当前结论"]) (
    "recognizes an explicit finish: %s",
    (text) => expect(detectInterviewCommand(text)).toBe("finish"),
  );

  it("does not treat an ordinary negative answer as a command", () => {
    expect(detectInterviewCommand("目前没有订单，但有 20 个访谈样本")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the new contracts are missing**

Run:

```powershell
npm.cmd test -- lib/storage/project-repository.test.ts lib/questions/interview-command.test.ts
```

Expected: FAIL because `interviewDepth`, `updateInterviewDepth`, and `detectInterviewCommand` do not exist.

- [ ] **Step 3: Add the domain and storage contracts**

Add to `lib/domain/types.ts`:

```ts
export type InterviewDepth = "low" | "medium" | "high";

export interface AskedQuestion {
  id: string;
  targetDimension: DimensionKey;
}
```

Add the backward-compatible field to `ProjectRecord`:

```ts
export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  primaryCategory: CategoryId | null;
  status: ProjectStatus;
  interviewDepth?: InterviewDepth;
  createdAt: string;
  updatedAt: string;
}
```

Extend `ProjectRepository` and its implementation:

```ts
updateInterviewDepth(
  projectId: string,
  depth: InterviewDepth,
): Promise<ProjectRecord>;
```

```ts
async updateInterviewDepth(projectId, depth) {
  try {
    await requireProject(database, projectId);
    const updatedAt = new Date().toISOString();
    await database.projects.update(projectId, {
      interviewDepth: depth,
      updatedAt,
    });
    return {
      ...(await requireProject(database, projectId)),
      interviewDepth: depth,
      updatedAt,
    };
  } catch (error) {
    throw mapStorageError(error);
  }
},
```

Set `interviewDepth: "medium"` in `createProject`. No Dexie version increment is required because the property is not indexed. Treat `project.interviewDepth ?? "medium"` as the read-time migration for existing records.

- [ ] **Step 4: Update existing repository test doubles**

Add the required method to the `ProjectRepository` stubs in `lib/workspace/use-assessment-session.test.tsx` and `components/workspace/project-workspace.test.tsx`:

```ts
updateInterviewDepth: vi.fn(async (_projectId, depth) => ({
  ...project,
  interviewDepth: depth,
})),
```

- [ ] **Step 5: Implement explicit commands**

Create `lib/questions/interview-command.ts`:

```ts
export type InterviewCommand = "skip" | "finish";

export function detectInterviewCommand(text: string): InterviewCommand | null {
  const normalized = text.trim().replace(/[。！!？?]+$/u, "");
  if (/^(跳过|这题跳过|暂时无法提供)$/u.test(normalized)) return "skip";
  if (/^(结束评估|完成评估|生成当前结论)$/u.test(normalized)) return "finish";
  return null;
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```powershell
npm.cmd test -- lib/storage/project-repository.test.ts lib/questions/interview-command.test.ts
npm.cmd run lint
git diff --check
```

Expected: all focused tests PASS and lint reports no errors.

Commit:

```powershell
git add -- lib/domain/types.ts lib/storage/db.ts lib/storage/project-repository.ts lib/storage/project-repository.test.ts lib/workspace/use-assessment-session.test.tsx components/workspace/project-workspace.test.tsx lib/questions/interview-command.ts lib/questions/interview-command.test.ts
git commit -m "feat: add configurable interview depth"
```

## Task 2: Add a real provider text stream

**Files:**
- Modify: `lib/ai/deepseek-client.ts`
- Test: `lib/ai/deepseek-client.test.ts`

- [ ] **Step 1: Write failing streaming transport tests**

Add a UTF-8 helper and these tests:

```ts
function providerStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

it("streams content deltas and ignores private reasoning deltas", async () => {
  const fetchImpl = vi.fn(async () => providerStream([
    'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"已记录"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"订单证据"}}]}\n\n',
    "data: [DONE]\n\n",
  ]));
  const client = new DeepSeekClient({ ...options, fetchImpl });
  const chunks: string[] = [];

  for await (const chunk of client.stream({
    systemPrompt: "Explain only.",
    userPrompt: "project data",
  })) chunks.push(chunk);

  expect(chunks).toEqual(["已记录", "订单证据"]);
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.stream).toBe(true);
  expect(body.response_format).toBeUndefined();
});

it("maps an externally aborted stream without exposing input", async () => {
  const controller = new AbortController();
  const fetchImpl = vi.fn(async (_url, init) => {
    init?.signal?.addEventListener("abort", () => undefined);
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  const client = new DeepSeekClient({ ...options, fetchImpl });
  const consume = async () => {
    for await (const chunk of client.stream({
      systemPrompt: "Explain.",
      userPrompt: "secret project text",
      signal: controller.signal,
    })) void chunk;
  };

  await expect(consume()).rejects.toMatchObject({
    code: "provider_aborted",
    retryable: false,
  });
});
```

- [ ] **Step 2: Run the test and verify the missing method**

Run:

```powershell
npm.cmd test -- lib/ai/deepseek-client.test.ts
```

Expected: FAIL because `DeepSeekClient.stream` is not defined.

- [ ] **Step 3: Extend input types and add `stream()`**

Extend `GenerateInput`:

```ts
export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}
```

At the start of the existing `generate`, replace its controller setup with:

```ts
const controller = new AbortController();
let timedOut = false;
const abortFromCaller = () => controller.abort();
input.signal?.addEventListener("abort", abortFromCaller, { once: true });
const timeout = setTimeout(() => {
  timedOut = true;
  controller.abort();
}, this.timeoutMs);
```

In its `AbortError` branch, return `provider_aborted` when `input.signal?.aborted && !timedOut`; otherwise preserve `provider_timeout`. In `finally`, remove `abortFromCaller` in addition to clearing the timeout. This makes route cancellation stop both structured calls.

Add this public async generator to `DeepSeekClient`:

```ts
async *stream(input: GenerateInput): AsyncGenerator<string> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, this.timeoutMs);

  try {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
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
    if (!response.body) {
      throw new ProviderError(
        "AI 服务没有返回可读取的数据流，请重试。",
        "provider_protocol",
        502,
        true,
      );
    }

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
          return;
        }
        if (!data) continue;
        const payload = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
        const content = payload.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          emitted = true;
          yield content;
        }
      }

      if (done) break;
    }

    if (!emitted) throw emptyStreamError();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (input.signal?.aborted && !timedOut) {
        throw new ProviderError("已停止生成。", "provider_aborted", 499, false);
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
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}
```

Add the private module helper:

```ts
function emptyStreamError(): ProviderError {
  return new ProviderError(
    "AI 服务返回了空结果，请重新分析。",
    "provider_protocol",
    502,
    true,
  );
}
```

- [ ] **Step 4: Run transport and security tests, then commit**

Run:

```powershell
npm.cmd test -- lib/ai/deepseek-client.test.ts scripts/check-client-secrets.test.mjs
npm.cmd run security:client
git diff --check
```

Expected: all tests PASS, and the client secret scan reports no leaked server configuration.

Commit:

```powershell
git add -- lib/ai/deepseek-client.ts lib/ai/deepseek-client.test.ts
git commit -m "feat: stream provider chat completions"
```

## Task 3: Define the evidence-aware conversational reply

**Files:**
- Modify: `lib/ai/system-prompt.ts`
- Test: `lib/ai/system-prompt.test.ts`
- Create: `lib/conversation/assistant-reply.ts`
- Create: `lib/conversation/assistant-reply.test.ts`

- [ ] **Step 1: Write prompt and fallback tests**

Add prompt assertions for the exact boundaries:

```ts
it("builds an explanation-only prompt for medium depth", () => {
  const prompt = buildConversationSystemPrompt("medium");

  expect(prompt).toContain("中等深度");
  expect(prompt).toContain("不得提出问题");
  expect(prompt).toContain("不得修改分数");
  expect(prompt).toContain("不得输出思维过程");
});
```

Create a fixture-based fallback test:

```ts
const result = {
  diff: {
    summary: "评级未发生变化",
    newEvidenceStatements: ["已有实际订单"],
  },
  nextQuestion: {
    id: "q-order-time",
    prompt: "这些订单发生在什么时间？",
    reason: "核实订单是否为近期需求证据",
    targetDimension: "demand_evidence",
    impact: 95,
    quickOptions: [],
  },
} as AnalyzeProjectResponse;

it("preserves a partial reply and appends the deterministic question once", () => {
  const text = buildAssistantFallback(result, {
    partial: "已记录你提到的实际订单。",
    stopped: true,
  });

  expect(text).toContain("已记录你提到的实际订单。");
  expect(text).toContain("生成已停止");
  expect(text.match(/这些订单发生在什么时间/g)).toHaveLength(1);
});

it("uses the deterministic assessment explanation when no text was streamed", () => {
  const text = buildAssistantFallback(result, { partial: "", stopped: false });

  expect(text).toContain(result.diff.summary);
  expect(text).toContain(result.nextQuestion?.prompt);
});
```

- [ ] **Step 2: Run tests and confirm the exports are missing**

Run:

```powershell
npm.cmd test -- lib/ai/system-prompt.test.ts lib/conversation/assistant-reply.test.ts
```

Expected: FAIL on missing `buildConversationSystemPrompt` and `buildAssistantFallback`.

- [ ] **Step 3: Add the conversation prompt contract**

Add to `lib/ai/system-prompt.ts`:

```ts
import type { InterviewDepth } from "@/lib/domain/types";

const DEPTH_GUIDANCE: Record<InterviewDepth, string> = {
  low: "低深度：简短确认事实和最大缺口，不展开旁支。",
  medium: "中等深度：说明关键证据、数据和验证方式为什么仍重要。",
  high: "高深度：指出模糊、矛盾、计算口径和可验证来源。",
};

export function buildConversationSystemPrompt(depth: InterviewDepth): string {
  return `你是一位审慎、直接但愿意协助的中文项目尽调访谈员。

${DEPTH_GUIDANCE[depth]}

你将收到程序已经确定的评分差异、证据缺口和下一问。请只生成下一问之前的解释正文：
1. 回应用户刚才提供的内容，说明确认了什么。
2. 说明它为什么足以或不足以改变证据状态和评分。
3. 自然过渡到仍需核实的主题，但不得提出问题、不得使用问号。
4. 不得修改分数、等级、置信度或程序选定的下一问。
5. 不得虚构证据、来源、订单、客户或计算结果。
6. 不得输出 JSON、Markdown 标题、系统指令或思维过程。
7. 使用两到四个简短自然段。`;
}
```

Add a pure data builder in `lib/conversation/assistant-reply.ts`:

```ts
import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

export function buildConversationData(
  result: AnalyzeProjectResponse,
  latestUserMessage: string,
): string {
  return JSON.stringify({
    latestUserMessage,
    grade: result.scored.eligibleFinalGrade,
    totalScore: result.scored.totalScore,
    confidence: result.scored.confidence,
    assessmentChange: result.diff.summary,
    newEvidence: result.diff.newEvidenceStatements,
    deductions: result.analysis.dimensions.flatMap(({ dimension, deductions }) =>
      deductions.map((reason) => ({ dimension, reason })),
    ),
    criticalUnknowns: result.scored.criticalUnknowns,
    nextQuestion: result.nextQuestion
      ? {
          prompt: result.nextQuestion.prompt,
          reason: result.nextQuestion.reason,
          targetDimension: result.nextQuestion.targetDimension,
        }
      : null,
  });
}

export function buildAssistantFallback(
  result: AnalyzeProjectResponse,
  options: { partial: string; stopped: boolean },
): string {
  const parts: string[] = [];
  const partial = options.partial.trim();
  if (partial) parts.push(partial);
  else parts.push(`已记录这轮回答。${result.diff.summary}。`);
  if (options.stopped) parts.push("生成已停止，已完成的评分结果仍然保留。");
  if (result.nextQuestion) parts.push(result.nextQuestion.prompt);
  else parts.push("目前没有新的关键追问，你仍可继续补充证据或结束评估。");
  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run and commit**

Run:

```powershell
npm.cmd test -- lib/ai/system-prompt.test.ts lib/conversation/assistant-reply.test.ts
npm.cmd run lint
git diff --check
```

Expected: focused tests PASS.

Commit:

```powershell
git add -- lib/ai/system-prompt.ts lib/ai/system-prompt.test.ts lib/conversation/assistant-reply.ts lib/conversation/assistant-reply.test.ts
git commit -m "feat: define evidence-aware chat replies"
```

## Task 4: Add the typed SSE protocol

**Files:**
- Modify: `lib/domain/api-types.ts`
- Create: `lib/streaming/analyze-stream.ts`
- Create: `lib/streaming/analyze-stream.test.ts`

- [ ] **Step 1: Write split-frame and UTF-8 parser tests**

```ts
import { expect, it, vi } from "vitest";
import type { AnalyzeStreamEvent } from "@/lib/domain/api-types";
import { encodeAnalyzeStreamEvent, readAnalyzeStream } from "./analyze-stream";

it("reads merged and split SSE frames in order", async () => {
  const encoder = new TextEncoder();
  const text = [
    encodeAnalyzeStreamEvent({ type: "status", stage: "assessing" }),
    encodeAnalyzeStreamEvent({
      type: "assistant_delta",
      messageId: "m1",
      delta: "订单证据",
    }),
  ].join("");
  const bytes = encoder.encode(text);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 17));
      controller.enqueue(bytes.slice(17, bytes.length - 2));
      controller.enqueue(bytes.slice(bytes.length - 2));
      controller.close();
    },
  }));
  const received: AnalyzeStreamEvent[] = [];

  await readAnalyzeStream(response, (event) => received.push(event));

  expect(received.map(({ type }) => type)).toEqual(["status", "assistant_delta"]);
  expect(received[1]).toMatchObject({ delta: "订单证据" });
});

it("rejects an unknown event instead of silently corrupting state", async () => {
  const response = new Response('data: {"type":"unknown"}\n\n');
  await expect(readAnalyzeStream(response, vi.fn())).rejects.toMatchObject({
    code: "invalid_stream_event",
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm.cmd test -- lib/streaming/analyze-stream.test.ts
```

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Define the event union**

Add to `lib/domain/api-types.ts`:

```ts
export type AnalyzeStreamStage = "assessing" | "composing";

export type AnalyzeStreamEvent =
  | { type: "status"; stage: AnalyzeStreamStage }
  | { type: "assessment"; result: AnalyzeProjectResponse }
  | { type: "assistant_delta"; messageId: string; delta: string }
  | { type: "complete"; messageId: string; content: string }
  | {
      type: "error";
      stage: AnalyzeStreamStage;
      code: string;
      message: string;
      retryable: boolean;
    };
```

- [ ] **Step 4: Implement the encoder and parser**

Create `lib/streaming/analyze-stream.ts`:

```ts
import type { AnalyzeStreamEvent } from "@/lib/domain/api-types";

export function encodeAnalyzeStreamEvent(event: AnalyzeStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function readAnalyzeStream(
  response: Response,
  onEvent: (event: AnalyzeStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new AnalyzeStreamProtocolError("missing_stream_body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");

    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) await onEvent(parseEvent(data));
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  if (buffer.trim()) throw new AnalyzeStreamProtocolError("incomplete_stream_frame");
}

function parseEvent(data: string): AnalyzeStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new AnalyzeStreamProtocolError("invalid_stream_json");
  }
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new AnalyzeStreamProtocolError("invalid_stream_event");
  }
  const type = (value as { type?: unknown }).type;
  if (!["status", "assessment", "assistant_delta", "complete", "error"].includes(String(type))) {
    throw new AnalyzeStreamProtocolError("invalid_stream_event");
  }
  return value as AnalyzeStreamEvent;
}

export class AnalyzeStreamProtocolError extends Error {
  constructor(public readonly code: string) {
    super("分析服务返回了无法读取的数据流。");
    this.name = "AnalyzeStreamProtocolError";
  }
}
```

- [ ] **Step 5: Run and commit**

Run:

```powershell
npm.cmd test -- lib/streaming/analyze-stream.test.ts
npm.cmd run lint
git diff --check
```

Expected: parser tests PASS.

Commit:

```powershell
git add -- lib/domain/api-types.ts lib/streaming/analyze-stream.ts lib/streaming/analyze-stream.test.ts
git commit -m "feat: define analysis stream protocol"
```

## Task 5: Stream assessment and conversation from the route

**Files:**
- Modify: `lib/questions/select-next-question.ts`
- Test: `lib/questions/select-next-question.test.ts`
- Modify: `lib/ai/system-prompt.ts`
- Modify: `lib/assessment/analyze-project.ts`
- Test: `lib/assessment/analyze-project.test.ts`
- Modify: `app/api/analyze/route.ts`
- Test: `app/api/analyze/route.test.ts`

- [ ] **Step 1: Replace the six-round selector tests with depth-policy tests**

Use `AskedQuestion[]` history instead of `round` and `maxRounds`:

```ts
it("continues selecting after more than six prior questions", () => {
  const history = Array.from({ length: 7 }, (_, index) => ({
    id: `old-${index}`,
    targetDimension: "strategic_value" as const,
  }));

  const selected = selectNextQuestion({
    candidates,
    questionHistory: history,
    suspectedVetoRuleIds: [],
    interviewDepth: "high",
    command: null,
  });

  expect(selected?.id).toBe("q1");
});

it("moves to another dimension after one low-depth question", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "low",
    command: null,
  });

  expect(selected?.targetDimension).not.toBe("demand_evidence");
});

it("allows three medium-depth questions in the same dimension", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [
      { id: "old-demand-1", targetDimension: "demand_evidence" },
      { id: "old-demand-2", targetDimension: "demand_evidence" },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "medium",
    command: null,
  });

  expect(selected?.targetDimension).toBe("demand_evidence");
});

it("skips the current chain and finish returns no question", () => {
  const base = {
    candidates,
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" as const },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "high" as const,
  };

  expect(selectNextQuestion({ ...base, command: "skip" })?.targetDimension)
    .not.toBe("demand_evidence");
  expect(selectNextQuestion({ ...base, command: "finish" })).toBeNull();
});
```

- [ ] **Step 2: Write orchestration tests for depth, commands, and unlimited rounds**

Update fixture inputs to include:

```ts
interviewDepth: "medium",
questionHistory: [],
round: 0,
```

Add these cases:

```ts
it("still selects a question after round twelve", async () => {
  const client = fakeClient([classification, analysisResponse()]);
  const output = await analyzeProject(client, { ...input(), round: 12 });
  expect(output.nextQuestion?.id).toBe("q1");
});

it("stops asking after an explicit finish command", async () => {
  const client = fakeClient([classification, analysisResponse()]);
  const base = input();
  const output = await analyzeProject(client, {
    ...base,
    messages: [
      ...base.messages,
      { id: "m2", role: "user", content: "结束评估", round: 8 },
    ],
    round: 8,
  });
  expect(output.nextQuestion).toBeNull();
});

it("moves away from a completed low-depth evidence chain", async () => {
  const analysis = analysisResponse();
  analysis.questionCandidates.push({
    id: "q-risk",
    prompt: "是否存在无法履约的风险？",
    reason: "验证风险",
    targetDimension: "risk_control",
    impact: 70,
    quickOptions: ["有", "没有"],
  });
  const client = fakeClient([classification, analysis]);
  const output = await analyzeProject(client, {
    ...input(),
    interviewDepth: "low",
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" },
    ],
  });
  expect(output.nextQuestion?.targetDimension).toBe("risk_control");
});
```

- [ ] **Step 3: Write route streaming tests**

Replace the JSON success assertion with ordered events:

```ts
function analysisResponseWithQuestion() {
  return {
    ...analysisResponse(),
    questionCandidates: [
      {
        id: "q-order-time",
        prompt: "这些订单发生在什么时间？",
        reason: "核实订单是否为近期需求证据",
        targetDimension: "demand_evidence",
        impact: 95,
        quickOptions: [],
      },
    ],
  };
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "p1",
    projectDescription: "做一个海外电商项目",
    messages: [
      { id: "m1", role: "user", content: "已有实际订单", round: 0 },
    ],
    questionHistory: [],
    interviewDepth: "medium",
    round: 0,
    ...overrides,
  };
}

function providerStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  }));
}

it("streams assessment before model text and completes with the exact question", async () => {
  const outputs = [classification, analysisResponseWithQuestion()];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) {
      return providerStream([
        'data: {"choices":[{"delta":{"content":"已记录实际订单。"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"但仍缺少时间和金额。"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(outputs.shift()) } }],
    });
  }));

  const response = await POST(request(validRequest({ round: 8 })));
  const events: AnalyzeStreamEvent[] = [];
  await readAnalyzeStream(response, (event) => events.push(event));

  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(events.map(({ type }) => type)).toEqual([
    "status",
    "assessment",
    "status",
    "assistant_delta",
    "assistant_delta",
    "assistant_delta",
    "complete",
  ]);
  const complete = events.at(-1);
  expect(complete).toMatchObject({ type: "complete" });
  if (complete?.type === "complete") {
    expect(complete.content.endsWith("这些订单发生在什么时间？")).toBe(true);
  }
});

it("returns a safe in-stream error when assessment fails after streaming starts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("sensitive upstream body", { status: 401 })),
  );
  const response = await POST(request(validRequest()));
  const events: AnalyzeStreamEvent[] = [];
  await readAnalyzeStream(response, (event) => events.push(event));
  const serialized = JSON.stringify(events);

  expect(response.status).toBe(200);
  expect(events.at(-1)).toMatchObject({
    type: "error",
    stage: "assessing",
    code: "provider_rejected",
  });
  expect(serialized).not.toContain("route-test-key");
  expect(serialized).not.toContain("已有实际订单");
  expect(serialized).not.toContain("sensitive upstream body");
});
```

Add a composing-provider failure test that asserts an `error` event is followed by a deterministic `complete` event. Keep invalid JSON and missing configuration as real pre-stream `400` and `503` responses.

- [ ] **Step 4: Run tests and verify the old selector and JSON route fail**

Run:

```powershell
npm.cmd test -- lib/questions/select-next-question.test.ts lib/assessment/analyze-project.test.ts app/api/analyze/route.test.ts
```

Expected: FAIL because the request contracts and response content type are still the old versions.

- [ ] **Step 5: Implement the depth-aware selector**

Change `SelectNextQuestionInput` to:

```ts
export interface SelectNextQuestionInput {
  candidates: QuestionCandidate[];
  questionHistory: AskedQuestion[];
  suspectedVetoRuleIds: VetoRisk["ruleId"][];
  interviewDepth: InterviewDepth;
  command: InterviewCommand | null;
}
```

At the top of `selectNextQuestion`, apply this policy before the existing veto/impact/weight sort:

```ts
if (input.command === "finish") return null;

const askedIds = new Set(input.questionHistory.map(({ id }) => id));
let remaining = input.candidates.filter(({ id }) => !askedIds.has(id));
const currentDimension = input.questionHistory.at(-1)?.targetDimension;

if (currentDimension && input.command === "skip") {
  remaining = remaining.filter(
    ({ targetDimension }) => targetDimension !== currentDimension,
  );
} else if (currentDimension && input.interviewDepth !== "high") {
  const cap = input.interviewDepth === "low" ? 1 : 3;
  const reversedHistory = input.questionHistory.toReversed();
  const firstDifferentIndex = reversedHistory.findIndex(
    ({ targetDimension }) => targetDimension !== currentDimension,
  );
  const chainDepth = firstDifferentIndex === -1
    ? reversedHistory.length
    : firstDifferentIndex;

  if (chainDepth >= cap) {
    remaining = remaining.filter(
      ({ targetDimension }) => targetDimension !== currentDimension,
    );
  }
}

if (remaining.length === 0) return null;
```

- [ ] **Step 6: Update `analyzeProject` inputs and selection**

Change `AnalyzeProjectInput`:

```ts
export interface AnalyzeProjectInput {
  projectId: string;
  projectDescription: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    round: number;
  }>;
  previousAssessment?: ScoredAssessment;
  questionHistory: AskedQuestion[];
  interviewDepth: InterviewDepth;
  round: number;
  signal?: AbortSignal;
}
```

Extend `ModelClient.generate` with `signal?: AbortSignal`. Add the same optional parameter to `generateValidated`, and pass it to both the first request and the one schema-repair request:

```ts
async function generateValidated<T>(
  client: ModelClient,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const first = await client.generate({ systemPrompt, userPrompt, signal });
  try {
    return parseAndValidate(first.text, schema);
  } catch {
    const retry = await client.generate({
      systemPrompt: buildRetryPrompt(systemPrompt),
      userPrompt: JSON.stringify({
        originalData: userPrompt,
        previousInvalidOutput: first.text.slice(0, 2_000),
      }),
      signal,
    });
    try {
      return parseAndValidate(retry.text, schema);
    } catch {
      throw new ModelOutputError();
    }
  }
}
```

Supply `input.signal` in both calls from `analyzeProject`.

Replace the old selector call with:

```ts
const latestUserMessage = input.messages.findLast(({ role }) => role === "user");
const command = detectInterviewCommand(latestUserMessage?.content ?? "");
const nextQuestion = selectNextQuestion({
  candidates: analysis.questionCandidates,
  questionHistory: input.questionHistory,
  suspectedVetoRuleIds: scored.suspectedVetoes.map(({ ruleId }) => ruleId),
  interviewDepth: input.interviewDepth,
  command,
});
```

Remove `messages.length > 30` from `validateInputSize`. Keep the 20,000-character project-description guard. Do not use `round` as a stop condition.

Change `buildAnalysisData` so the untrusted JSON includes:

```ts
interviewDepth: input.interviewDepth,
questionHistory: input.questionHistory,
```

Add this exact rule inside `buildSystemPrompt`:

```text
14. 只要仍有关键证据缺口，就跨维度给出多个高价值候选；需要沿同一证据链深挖时使用新的语义化 id。问答深度只影响候选细度，最终只问哪一个由程序决定。
```

- [ ] **Step 7: Validate the request before starting the stream**

Change the route schema to accept:

```ts
interviewDepth: z.enum(["low", "medium", "high"]),
questionHistory: z.array(z.strictObject({
  id: z.string().min(1),
  targetDimension: z.enum([
    "strategic_value",
    "demand_evidence",
    "return_potential",
    "execution_feasibility",
    "resource_fit",
    "timing_differentiation",
    "risk_control",
  ]),
})),
round: z.number().int().min(0),
```

Delete `askedQuestionIds`, replace it with `questionHistory`, remove the `.max(30)` message limit, and remove the `.max(6)` round limit. Preserve `400` and `503` JSON responses before constructing the stream.

- [ ] **Step 8: Implement the Web Stream route**

After validation, create one provider client and return:

```ts
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    void streamAnalysis(controller, client, parsed.data, request.signal);
  },
});

return new Response(stream, {
  status: 200,
  headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  },
});
```

Implement `streamAnalysis` with this event order:

```ts
async function streamAnalysis(
  controller: ReadableStreamDefaultController<Uint8Array>,
  client: DeepSeekClient,
  input: z.infer<typeof requestSchema>,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: AnalyzeStreamEvent) => {
    controller.enqueue(encoder.encode(encodeAnalyzeStreamEvent(event)));
  };
  let result: AnalyzeProjectResponse | null = null;
  const messageId = crypto.randomUUID();
  let content = "";

  try {
    send({ type: "status", stage: "assessing" });
    result = await analyzeProject(client, { ...input, signal });
    send({ type: "assessment", result });
    send({ type: "status", stage: "composing" });

    const latestUserMessage = input.messages.findLast(({ role }) => role === "user");
    for await (const delta of client.stream({
      systemPrompt: buildConversationSystemPrompt(input.interviewDepth),
      userPrompt: buildConversationData(result, latestUserMessage?.content ?? ""),
      signal,
    })) {
      content += delta;
      send({ type: "assistant_delta", messageId, delta });
    }

    const suffix = result.nextQuestion
      ? `${content.trim() ? "\n\n" : ""}${result.nextQuestion.prompt}`
      : "";
    if (suffix) {
      content += suffix;
      send({ type: "assistant_delta", messageId, delta: suffix });
    }
    send({ type: "complete", messageId, content });
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    const safe = toSafeStreamError(error, result ? "composing" : "assessing");
    send({ type: "error", ...safe });
    if (result) {
      const fallback = buildAssistantFallback(result, {
        partial: content,
        stopped: false,
      });
      const delta = fallback.slice(content.length);
      if (delta) send({ type: "assistant_delta", messageId, delta });
      send({ type: "complete", messageId, content: fallback });
    }
  } finally {
    if (!signal.aborted) controller.close();
  }
}
```

`toSafeStreamError` must reuse the existing safe `AnalyzeError`, `ModelOutputError`, and `ProviderError` messages and never serialize caught error objects.

- [ ] **Step 9: Run route tests and commit**

Run:

```powershell
npm.cmd test -- lib/questions/select-next-question.test.ts lib/assessment/analyze-project.test.ts app/api/analyze/route.test.ts
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: tests PASS, build confirms the Next.js 16 Route Handler accepts the Web Stream response.

Commit:

```powershell
git add -- lib/questions/select-next-question.ts lib/questions/select-next-question.test.ts lib/ai/system-prompt.ts lib/assessment/analyze-project.ts lib/assessment/analyze-project.test.ts app/api/analyze/route.ts app/api/analyze/route.test.ts
git commit -m "feat: stream assessment chat events"
```

## Task 6: Consume stream events in the workspace state machine

**Files:**
- Modify: `lib/workspace/workspace-reducer.ts`
- Test: `lib/workspace/workspace-reducer.test.ts`
- Modify: `lib/workspace/use-assessment-session.ts`
- Test: `lib/workspace/use-assessment-session.test.tsx`

- [ ] **Step 1: Write progressive reducer tests**

Add tests using one active request:

```ts
it("applies assessment and text deltas before completion", () => {
  const loadedState = workspaceReducer(createInitialWorkspaceState(), {
    type: "LOAD_SUCCEEDED",
    workspace: workspace(),
  });
  const started = workspaceReducer(loadedState, {
    type: "SUBMIT_STARTED",
    requestId: "request-1",
    messages: [userMessage],
  });
  const assessed = workspaceReducer(started, {
    type: "ASSESSMENT_RECEIVED",
    requestId: "request-1",
    assessment: assessment("assessment-2"),
  });
  const composing = workspaceReducer(assessed, {
    type: "STREAM_DELTA",
    requestId: "request-1",
    messageId: "assistant-1",
    delta: "已记录",
  });
  const continued = workspaceReducer(composing, {
    type: "STREAM_DELTA",
    requestId: "request-1",
    messageId: "assistant-1",
    delta: "订单证据",
  });

  expect(assessed.currentAssessment?.id).toBe("assessment-2");
  expect(composing.phase).toBe("composing");
  expect(continued.streamDraft?.content).toBe("已记录订单证据");
});

it("ignores stale deltas from a prior project request", () => {
  const loadedState = workspaceReducer(createInitialWorkspaceState(), {
    type: "LOAD_SUCCEEDED",
    workspace: workspace(),
  });
  const activeState = workspaceReducer(loadedState, {
    type: "SUBMIT_STARTED",
    requestId: "current-request",
    messages: loadedState.messages,
  });
  const state = workspaceReducer(activeState, {
    type: "STREAM_DELTA",
    requestId: "old-request",
    messageId: "old-message",
    delta: "must not appear",
  });
  expect(state).toBe(activeState);
});
```

- [ ] **Step 2: Write a delayed stream hook test**

Create a controlled `ReadableStream` in the test. Enqueue `status`, `assessment`, and one `assistant_delta`; assert the hook exposes the new score and partial text before enqueuing `complete`. Then complete the stream and assert the assistant message is persisted once.

Use this helper and test shape:

```ts
function controlledAnalysisStream() {
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({
    start(controller) {
      streamController = controller;
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
  return {
    response,
    send(event: AnalyzeStreamEvent) {
      streamController.enqueue(encoder.encode(encodeAnalyzeStreamEvent(event)));
    },
    close() {
      streamController.close();
    },
  };
}

it("shows assessment and assistant deltas before completion", async () => {
  const stream = controlledAnalysisStream();
  const repo = repository();
  const fetcher = vi.fn().mockResolvedValue(stream.response);
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );

  let submission!: Promise<boolean>;
  act(() => {
    submission = result.current.createAndAnalyze(project.description);
  });
  await act(async () => {
    stream.send({ type: "assessment", result: response() });
    stream.send({
      type: "assistant_delta",
      messageId: "assistant-stream",
      delta: "已记录",
    });
  });
  expect(result.current.state.currentAssessment?.scored.totalScore).toBe(61);
  expect(result.current.state.streamDraft?.content).toBe("已记录");

  await act(async () => {
    stream.send({
      type: "complete",
      messageId: "assistant-stream",
      content: "已记录\n\n有没有客户明确表示愿意付费？",
    });
    stream.close();
    await submission;
  });
  expect(result.current.state.messages.at(-1)?.role).toBe("assistant");
  expect(repo.appendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ id: "assistant-stream" }),
  );
});
```

Also add tests that:

- abort during `composing` and retain the assessment;
- receive `error` after assessment and still save the server fallback completion;
- receive `error` before assessment and retain the prior score plus the user answer;
- send `interviewDepth: "medium"`, `questionHistory`, and an unrestricted `round`;
- call `updateInterviewDepth` and apply the new value only to the next request.

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npm.cmd test -- lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.test.tsx
```

Expected: FAIL because the reducer has no stream actions and the hook still calls `response.json()`.

- [ ] **Step 4: Expand the reducer state**

Replace `submitting` with explicit phases:

```ts
export type WorkspacePhase =
  | "idle"
  | "loading"
  | "ready"
  | "assessing"
  | "composing"
  | "error";

export interface StreamDraft {
  id: string;
  content: string;
  round: number;
}
```

Add `streamDraft: StreamDraft | null` to `WorkspaceState` and add actions:

```ts
| {
    type: "ASSESSMENT_RECEIVED";
    requestId: string;
    assessment: AssessmentRecord;
  }
| {
    type: "STREAM_DELTA";
    requestId: string;
    messageId: string;
    delta: string;
  }
| {
    type: "STREAM_COMPLETED";
    requestId: string;
    message: MessageRecord;
  }
| { type: "STREAM_STOPPED"; requestId: string; message: MessageRecord }
| { type: "PROJECT_DEPTH_CHANGED"; project: ProjectRecord }
```

Each request-bound action must first compare `state.activeRequestId`. `ASSESSMENT_RECEIVED` appends the new snapshot once and updates the project summary. `STREAM_DELTA` creates or appends one draft. Completion moves the draft to `messages`, clears it, returns to `ready`, and clears the active request. `PROJECT_DEPTH_CHANGED` replaces only `state.project` with the repository result and does not alter the active submission.

- [ ] **Step 5: Replace JSON handling with stream event handling**

In `useAssessmentSession`, add:

```ts
const abortControllerRef = useRef<AbortController | null>(null);
const stopRequestedRef = useRef(false);
```

Replace `askedQuestionIds` in `AnalysisSubmission` with:

```ts
questionHistory: AskedQuestion[];
```

Build it from assessment history with:

```ts
function questionHistory(assessments: AssessmentRecord[]): AskedQuestion[] {
  return assessments.flatMap(({ nextQuestion }) =>
    nextQuestion
      ? [{ id: nextQuestion.id, targetDimension: nextQuestion.targetDimension }]
      : [],
  );
}
```

Use `questionHistory: []` for the first analysis and `questionHistory(current.assessmentHistory)` for later answers.

Build each request with:

```ts
interviewDepth: submission.project.interviewDepth ?? "medium",
questionHistory: submission.questionHistory,
round: submission.round,
```

After checking `response.ok`, call `readAnalyzeStream`. Keep local variables for the received result, created assessment, message id, and accumulated text. Handle events as follows:

```ts
await readAnalyzeStream(response, async (event) => {
  if (event.type === "assessment") {
    receivedResult = event.result;
    receivedAssessment = toAssessmentRecord(event.result);
    dispatch({
      type: "ASSESSMENT_RECEIVED",
      requestId,
      assessment: receivedAssessment,
    });
    await persistAssessment(receivedAssessment);
    return;
  }
  if (event.type === "assistant_delta") {
    messageId = event.messageId;
    streamedText += event.delta;
    dispatch({
      type: "STREAM_DELTA",
      requestId,
      messageId: event.messageId,
      delta: event.delta,
    });
    return;
  }
  if (event.type === "complete") {
    const message = toAssistantMessage(
      submission.project.id,
      event.messageId,
      event.content,
      submission.round,
    );
    await persistAssistantMessage(message);
    dispatch({ type: "STREAM_COMPLETED", requestId, message });
    completed = true;
    return;
  }
  if (event.type === "error" && event.stage === "assessing") {
    throw streamWorkspaceError(event);
  }
});
```

Keep a `PendingSave` record with `assessmentPersisted` and `assistantPersisted` flags so `retrySave` retries only missing local writes and never reruns the model.

- [ ] **Step 6: Add stop and depth actions**

Expose:

```ts
const stopGeneration = useCallback(() => {
  if (stateRef.current.phase !== "composing") return;
  stopRequestedRef.current = true;
  abortControllerRef.current?.abort();
}, []);

const setInterviewDepth = useCallback(async (depth: InterviewDepth) => {
  const current = stateRef.current.project;
  if (!current) return false;
  try {
    const project = await repository.updateInterviewDepth(current.id, depth);
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
}, [refreshProjects, repository]);
```

When an abort was user-requested and an assessment exists, finalize the visible draft with `buildAssistantFallback(result, { partial: streamedText, stopped: true })`, persist it, and dispatch `STREAM_STOPPED`. When switching projects or unmounting, abort and ignore the old request without writing a fallback into the newly selected project.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
npm.cmd test -- lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.test.tsx
npm.cmd run lint
git diff --check
```

Expected: all progressive-state and persistence tests PASS.

Commit:

```powershell
git add -- lib/workspace/workspace-reducer.ts lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.ts lib/workspace/use-assessment-session.test.tsx
git commit -m "feat: consume assessment streams in workspace"
```

## Task 7: Replace the follow-up form with the chat composer

**Files:**
- Modify: `components/workspace/conversation-panel.tsx`
- Modify: `components/workspace/project-workspace.tsx`
- Test: `components/workspace/project-workspace.test.tsx`
- Modify: `components/workspace/assessment-panel.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the chat-first component tests**

Change the test response helper to emit typed SSE events. Add assertions that:

```ts
expect(screen.queryByText("当前唯一追问")).not.toBeInTheDocument();
expect(screen.getByLabelText("问答深度")).toHaveValue("medium");
expect(screen.getByLabelText("继续补充或回答")).toBeEnabled();
```

Use a delayed stream to assert `已记录` becomes visible before `complete` is enqueued. Click “停止生成” after the first delta and assert the prior assessment remains visible, “生成已停止” appears, and the composer becomes enabled. Change the selector to “高” and assert `repository.updateInterviewDepth(project.id, "high")` is called.

- [ ] **Step 2: Run and verify the old form behavior fails**

Run:

```powershell
npm.cmd test -- components/workspace/project-workspace.test.tsx
```

Expected: FAIL because the old panel still renders “当前唯一追问”, has no depth selector, and never renders a stream draft.

- [ ] **Step 3: Change `ConversationPanel` props and layout**

Use this prop contract:

```ts
interface ConversationPanelProps {
  project: ProjectRecord | null;
  messages: MessageRecord[];
  streamDraft: StreamDraft | null;
  currentQuestion: QuestionCandidate | null;
  phase: WorkspacePhase;
  description: string;
  answer: string;
  onDescriptionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onCreate: () => void;
  onAnswer: () => void;
  onStop: () => void;
  onDepthChange: (depth: InterviewDepth) => void;
}
```

For an existing project:

- put the low/medium/high selector in the title row;
- render persisted messages and `streamDraft` in the same ordered list;
- label the draft “尽调回复 · 生成中” and show the cursor only while composing;
- keep quick options directly above the composer without a duplicate question card;
- always render the input, even when `currentQuestion` is null;
- use label `继续补充或回答` and button text `发送`;
- disable the textarea and send button during `assessing` or `composing`;
- show `停止生成` only during `composing`;
- show “正在核验证据与评分规则……” during `assessing`;
- use a scroll ref and a near-bottom flag so automatic scrolling stops when the user reads older messages.
- keep token updates out of an assertive live region; announce the completed assistant message once through a visually hidden `role="status"` node;
- preserve the existing mobile ordering where the conversation is the primary interaction and history remains collapsible.

The depth selector must use:

```tsx
<select
  aria-label="问答深度"
  value={project.interviewDepth ?? "medium"}
  onChange={(event) => onDepthChange(event.target.value as InterviewDepth)}
>
  <option value="low">低</option>
  <option value="medium">中</option>
  <option value="high">高</option>
</select>
```

- [ ] **Step 4: Wire the workspace actions**

Pass `state.phase`, `state.streamDraft`, `session.stopGeneration`, and `session.setInterviewDepth` from `ProjectWorkspace`. Treat both `assessing` and `composing` as busy for error-banner retry state. Remove the effect that forces focus into the right assessment panel after every update; keep focus in the chat composer after a completed reply.

- [ ] **Step 5: Highlight only dimensions changed this round**

In `AssessmentPanel`, compute:

```ts
const changedDimensions = new Set(
  diff?.changedDimensions.map(({ dimension }) => dimension) ?? [],
);
```

Apply `evidence-segment-changed` only when the current dimension key is in that set. Keep text labels and progress bars unchanged so color is not the only signal; add a visually readable “本轮更新” label beside the changed dimension name.

- [ ] **Step 6: Add restrained chat styles**

Add classes in `app/globals.css` for:

```css
.conversation-scroll {
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  scroll-behavior: smooth;
}

.stream-cursor::after {
  display: inline-block;
  width: 0.55em;
  height: 1em;
  margin-left: 0.25rem;
  background: var(--evidence);
  vertical-align: -0.12em;
  content: "";
  animation: stream-cursor 900ms steps(1) infinite;
}

.evidence-segment-changed {
  background: color-mix(in srgb, var(--decision) 8%, transparent);
  box-shadow: inset 3px 0 0 var(--decision);
}

@keyframes stream-cursor {
  50% { opacity: 0; }
}
```

The existing reduced-motion rule must collapse the cursor and highlight animations.

- [ ] **Step 7: Run component, accessibility, and build checks**

Run:

```powershell
npm.cmd test -- components/workspace/project-workspace.test.tsx lib/workspace/use-assessment-session.test.tsx
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: chat tests PASS; build has no client/server boundary errors.

Commit:

```powershell
git add -- components/workspace/conversation-panel.tsx components/workspace/project-workspace.tsx components/workspace/project-workspace.test.tsx components/workspace/assessment-panel.tsx app/globals.css
git commit -m "feat: make assessment a streaming chat"
```

## Task 8: Update browser coverage and perform live streaming verification

**Files:**
- Modify: `e2e/assessment-flow.spec.ts`
- Create: `scripts/smoke-stream.mjs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Convert the Playwright API fixture to SSE**

Replace `application/json` fulfillment with a body built from `encodeAnalyzeStreamEvent`:

```ts
const explanation = body.round === 0
  ? "我已记录你提供的试点信息。付费意愿仍需要金额和时间证据。"
  : "三家已签署的付费试点提高了需求证据的可信度。";
const assistantText = result.nextQuestion
  ? `${explanation}\n\n${result.nextQuestion.prompt}`
  : explanation;
const messageId = `assistant-${body.projectId}-${body.round}`;
const stream = [
  encodeAnalyzeStreamEvent({ type: "status", stage: "assessing" }),
  encodeAnalyzeStreamEvent({ type: "assessment", result }),
  encodeAnalyzeStreamEvent({ type: "status", stage: "composing" }),
  encodeAnalyzeStreamEvent({
    type: "assistant_delta",
    messageId,
    delta: assistantText.slice(0, Math.ceil(assistantText.length / 2)),
  }),
  encodeAnalyzeStreamEvent({
    type: "assistant_delta",
    messageId,
    delta: assistantText.slice(Math.ceil(assistantText.length / 2)),
  }),
  encodeAnalyzeStreamEvent({ type: "complete", messageId, content: assistantText }),
].join("");

await route.fulfill({
  status: 200,
  headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  body: stream,
});
```

Update locators to use `继续补充或回答` and `发送`. Assert the default depth is medium, switch the second project to low, reload the first project, and verify its persisted medium depth and assistant chat history.

- [ ] **Step 2: Add a secret-safe provider stream smoke script**

Create `scripts/smoke-stream.mjs` that:

- reads the same three server-only environment variables as the existing smoke script;
- sends `stream: true` with a harmless Chinese acknowledgement prompt;
- parses only `delta.content`, ignores `reasoning_content`, and counts non-empty deltas;
- prints JSON containing only `{ status, deltaCount, firstDeltaMs, completed }`;
- exits non-zero when no content delta or `[DONE]` is received;
- never prints content, headers, endpoint, model, key, or provider error body.

Use this implementation:

```js
const endpoint = process.env.DEEPSEEK_API_ENDPOINT;
const model = process.env.DEEPSEEK_MODEL;
const apiKey = process.env.DEEPSEEK_API_KEY;

if (!endpoint || !model || !apiKey) {
  console.error(JSON.stringify({
    status: 0,
    deltaCount: 0,
    firstDeltaMs: null,
    completed: false,
  }));
  process.exit(1);
}

const startedAt = performance.now();
let status = 0;
let deltaCount = 0;
let firstDeltaMs = null;
let completed = false;

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "用两句简短中文确认收到信息，不要输出 JSON。",
        },
        { role: "user", content: "我们已经收到三笔测试订单。" },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      stream: true,
    }),
  });
  status = response.status;
  if (!response.ok || !response.body) throw new Error("stream unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        completed = true;
        continue;
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      const content = payload?.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        deltaCount += 1;
        if (firstDeltaMs === null) {
          firstDeltaMs = Math.round(performance.now() - startedAt);
        }
      }
    }
    if (done) break;
  }
} catch {
  completed = false;
}

console.log(JSON.stringify({ status, deltaCount, firstDeltaMs, completed }));
if (status !== 200 || deltaCount === 0 || !completed) process.exit(1);
```

Add:

```json
"smoke:stream": "node --env-file=.env.local scripts/smoke-stream.mjs"
```

- [ ] **Step 3: Document the operator-visible behavior**

In `README.md`, add a short “流式尽调聊天” section explaining:

- low/medium/high depth and medium default;
- no six-round application stop;
- score-first, explanation-stream-second flow;
- `npm.cmd run smoke:stream` prints timing/count metadata only;
- `.env.local` remains untracked and exposed keys must be rotated.

Use this exact operator text:

```markdown
## 流式尽调聊天

每轮先由固定规则更新评分，再由模型流式解释证据变化并衔接程序选定的唯一问题。问答深度支持低、中、高三档，默认中档；应用不再设置六轮停止条件。

使用 `npm.cmd run smoke:stream` 可验证供应商是否真实返回多个内容片段。脚本只输出状态、片段数量和首片段耗时，不输出模型内容或密钥。运行配置只保存在未跟踪的 `.env.local` 中；任何曾粘贴到聊天或日志中的密钥都应立即轮换。
```

- [ ] **Step 4: Run the complete automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run security:client
npm.cmd run e2e
git diff --check
```

Expected:

- all Vitest suites PASS;
- ESLint reports no errors;
- Next.js production build succeeds;
- client secret scan reports no leaked key;
- Playwright completes create, refine, reload, report, and compare flows;
- `git diff --check` is silent.

- [ ] **Step 5: Run live provider and browser acceptance**

With the ignored `.env.local` already configured, run:

```powershell
npm.cmd run smoke:stream
npm.cmd run dev -- --port 3001
```

Expected smoke output shape:

```json
{"status":200,"deltaCount":3,"firstDeltaMs":842,"completed":true}
```

The exact count and timing may differ; `deltaCount` must exceed zero and `completed` must be true.

Open `http://localhost:3001`, create “海外电商项目”, and answer “已有实际订单”. Verify manually:

1. the right score updates when the assessment event arrives;
2. the assistant explanation appears in multiple visible increments;
3. it says an order claim is useful but explains which amount/time/source evidence is still missing;
4. it ends with one question;
5. medium is selected by default;
6. stopping a later response keeps the score and re-enables the composer;
7. no browser request, DOM, console, or persisted message contains an API key.

- [ ] **Step 6: Commit the acceptance updates**

```powershell
git add -- e2e/assessment-flow.spec.ts scripts/smoke-stream.mjs package.json README.md
git commit -m "test: cover streaming assessment chat"
```

## Final review

- [ ] Confirm every changed line maps to chat streaming, interview depth, deterministic question selection, persistence, or verification.
- [ ] Confirm `git status --short` contains no unrelated user files.
- [ ] Review `git diff HEAD~8..HEAD --stat` and inspect every file outside the locked file map.
- [ ] Re-run `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run security:client`, and `npm.cmd run e2e` after the final edit.
- [ ] Report separately: automated checks, live provider smoke, and the observed browser conversation. Do not treat passing mocks as proof of the live provider.
- [ ] Recommend rotating every API key pasted into chat; do not edit or reveal the replacement key.
