# SABC Two-Agent Interview and Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Split the product into an interview-only A page, a recoverable market-research waiting page, and a conversational B page whose first message is the saved S/A/B/C report and recommendation.

**Architecture:** Keep the current /api/chat interview stream and /api/finalize research/score pipeline. Add durable interview/advisory message metadata, a text-only /api/advisor stream, /research/[projectId] orchestration, and /advisor/[projectId] presentation; infer recovery from saved research, report, and advisor-summary records rather than a second workflow-state table.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Dexie/IndexedDB, Zod, Vitest + Testing Library, Playwright, Tailwind CSS 4.

---

## File responsibility map

- lib/conversation/message-stage.ts: backward-compatible interview/advisory message classification.
- lib/advisor/advisor-context.ts: small model context derived from the immutable final report.
- lib/advisor/advisor-prompt.ts: B-agent system prompt and serialized request data.
- app/api/advisor/route.ts: strict, safe SSE route for opening and follow-up advice.
- lib/advisor/advisor-client.ts: browser SSE reader that returns only a complete message.
- lib/advisor/use-advisor-session.ts: B-page load, send, retry, stop, and persistence state.
- components/research/research-handoff-screen.tsx: resume-aware finalization and opening-summary orchestration.
- components/research/research-progress.tsx: five real waiting stages and scoped retry actions.
- components/advisor/advisor-screen.tsx: project navigation plus B-agent conversation shell.
- components/advisor/advisor-summary.tsx: report-shaped first chat message using saved scoring data.
- components/advisor/advisor-conversation.tsx: advisory-only message stream and composer.

### Task 1: Persist and enforce the A/B message boundary

**Files:**
- Modify: lib/storage/db.ts
- Create: lib/conversation/message-stage.ts
- Create: lib/conversation/message-stage.test.ts
- Modify: lib/workspace/use-assessment-session.ts
- Modify: lib/workspace/use-assessment-session.test.tsx
- Modify: lib/report/create-report-content.ts
- Modify: lib/report/create-report-content.test.ts

- [ ] **Step 1: Write failing classification and persistence tests**

Add tests that define old messages as interview messages and ensure advisory messages never enter finalization or the report conversation summary:

~~~ts
const legacy = { ...baseMessage } satisfies MessageRecord;
const advisory = {
  ...baseMessage,
  id: "advisor-1",
  stage: "advisory",
  kind: "advisor_summary",
} satisfies MessageRecord;

expect(isInterviewMessage(legacy)).toBe(true);
expect(isInterviewMessage(advisory)).toBe(false);
expect(isAdvisoryMessage(advisory)).toBe(true);
expect(isAdvisorSummary(advisory)).toBe(true);
~~~

In use-assessment-session.test.tsx, assert created user and assistant messages have stage interview, and a loaded advisory message is absent from the /api/finalize body. In create-report-content.test.ts, pass one interview and one advisory message and assert conversationSummary contains only the interview text.

- [ ] **Step 2: Run the focused tests and verify RED**

~~~powershell
npm.cmd test -- lib/conversation/message-stage.test.ts lib/workspace/use-assessment-session.test.tsx lib/report/create-report-content.test.ts
~~~

Expected: FAIL because MessageRecord.stage, MessageRecord.kind, and the classification functions do not exist.

- [ ] **Step 3: Add the minimal metadata and helpers**

Extend MessageRecord without changing Dexie indexes:

~~~ts
export interface MessageRecord {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  round: number;
  createdAt: string;
  stage?: "interview" | "advisory";
  kind?: "chat" | "advisor_summary";
}
~~~

Create the compatibility helpers:

~~~ts
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
~~~

Set stage interview and kind chat on every new A-page user/assistant message. Filter with isInterviewMessage when building /api/chat, /api/finalize, and createReportContent() inputs.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS with created, streamed, finalized, and summarized messages respecting the stage boundary.

- [ ] **Step 5: Commit the boundary**

~~~powershell
git add lib/storage/db.ts lib/conversation/message-stage.ts lib/conversation/message-stage.test.ts lib/workspace/use-assessment-session.ts lib/workspace/use-assessment-session.test.tsx lib/report/create-report-content.ts lib/report/create-report-content.test.ts
git commit -m "feat: separate interview and advisor messages"
~~~

### Task 2: Build a bounded advisor context and prompt

**Files:**
- Create: lib/advisor/advisor-context.ts
- Create: lib/advisor/advisor-context.test.ts
- Create: lib/advisor/advisor-prompt.ts
- Create: lib/advisor/advisor-prompt.test.ts

- [ ] **Step 1: Write failing context and prompt tests**

Use a final report with grade A, score 78, confidence 80, seven scored dimensions, one allowed source, and one conversation-summary line. Assert:

~~~ts
const context = createAdvisorContext(project, report);

expect(context).toMatchObject({
  projectId: project.id,
  projectName: project.name,
  grade: "A",
  totalScore: 78,
  confidence: 80,
  researchStatus: "completed",
});
expect(context.dimensions).toHaveLength(7);
expect(context.sources).toEqual(report.assessmentSnapshot.sources);
expect(buildAdvisorSystemPrompt("opening")).toContain("不得重新计算或修改等级");
expect(buildAdvisorData({ mode: "opening", context, messages: [] })).toContain(
  '"grade":"A"',
);
expect(createAdvisorOpeningPrefix("S")).toBe(
  "根据目前的情况，我把这个项目评为 S 级。\n\n",
);
~~~

- [ ] **Step 2: Run the tests and verify RED**

~~~powershell
npm.cmd test -- lib/advisor/advisor-context.test.ts lib/advisor/advisor-prompt.test.ts
~~~

Expected: FAIL because the advisor modules do not exist.

- [ ] **Step 3: Implement the compact context and text-only prompt**

Define the cross-boundary context:

~~~ts
export interface AdvisorContext {
  projectId: string;
  projectName: string;
  projectDescription: string;
  categoryReason: string;
  grade: Grade;
  totalScore: number;
  confidence: number;
  researchStatus: "not_needed" | ResearchStatus;
  dimensions: Array<{
    key: DimensionKey;
    appliedScore: number;
    facts: string[];
    deductions: string[];
  }>;
  report: ReportContent;
  sources: SourceReference[];
}
~~~

Build it only from ProjectRecord plus FinalReportRecord.assessmentSnapshot. Limit each facts/deductions array to eight entries and use the existing bounded ReportContent arrays. The system prompt must say supplied sources are the only researched sources, the saved grade is immutable in this conversation, opening advice should lead with decisions and actions, and follow-up answers must disclose when saved research cannot support a claim.

~~~ts
export type AdvisorMode = "opening" | "reply";

export function createAdvisorOpeningPrefix(grade: Grade): string {
  return "根据目前的情况，我把这个项目评为 " + grade + " 级。\n\n";
}
~~~

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS; the context contains the saved result but no raw IndexedDB object or secret configuration.

- [ ] **Step 5: Commit the advisor context**

~~~powershell
git add lib/advisor/advisor-context.ts lib/advisor/advisor-context.test.ts lib/advisor/advisor-prompt.ts lib/advisor/advisor-prompt.test.ts
git commit -m "feat: define advisor report context"
~~~

### Task 3: Add the safe streaming B-agent route

**Files:**
- Create: app/api/advisor/route.ts
- Create: app/api/advisor/route.test.ts

- [ ] **Step 1: Write failing route tests**

Mock DeepSeekClient.stream() and cover opening, reply, strict input, missing configuration, and provider failure:

~~~ts
expect(openingEvents).toEqual([
  expect.objectContaining({
    type: "assistant_delta",
    delta: "根据目前的情况，我把这个项目评为 A 级。\n\n",
  }),
  expect.objectContaining({
    type: "assistant_delta",
    delta: "建议先验证复购。",
  }),
  expect.objectContaining({
    type: "complete",
    content:
      "根据目前的情况，我把这个项目评为 A 级。\n\n建议先验证复购。",
  }),
]);
~~~

For mode reply, assert no fixed prefix. An unknown field returns 400 invalid_input, missing environment configuration returns 503 missing_configuration, and a provider error becomes a safe SSE error without the provider body.

- [ ] **Step 2: Run the route test and verify RED**

~~~powershell
npm.cmd test -- app/api/advisor/route.test.ts
~~~

Expected: FAIL because /api/advisor does not exist.

- [ ] **Step 3: Implement strict validation and SSE**

Use z.strictObject for:

~~~ts
const requestSchema = z.strictObject({
  mode: z.enum(["opening", "reply"]),
  context: advisorContextSchema,
  messages: z.array(advisorMessageSchema).max(100),
});
~~~

Require zero advisory messages for opening and at least one final user message for reply. Reuse encodeChatStreamEvent(). In opening mode, send and accumulate createAdvisorOpeningPrefix(input.context.grade) before provider deltas. Return complete only after the provider finishes; on failure return the safe error shape used by /api/chat.

- [ ] **Step 4: Run the route tests and verify GREEN**

~~~powershell
npm.cmd test -- app/api/advisor/route.test.ts app/api/chat/route.test.ts lib/streaming/chat-stream.test.ts
~~~

Expected: PASS with the existing interview route unchanged.

- [ ] **Step 5: Commit the route**

~~~powershell
git add app/api/advisor/route.ts app/api/advisor/route.test.ts
git commit -m "feat: stream project advisor replies"
~~~

### Task 4: Add the reusable advisor browser client and session hook

**Files:**
- Create: lib/advisor/advisor-client.ts
- Create: lib/advisor/advisor-client.test.ts
- Create: lib/advisor/use-advisor-session.ts
- Create: lib/advisor/use-advisor-session.test.tsx

- [ ] **Step 1: Write failing client and hook tests**

Test a two-delta completion, safe API error, incomplete SSE, stopped generation, message persistence, and retry without duplicating the last user message. The opening-mode client result must contain the full fixed prefix and provider advice, but the client itself must not write IndexedDB:

~~~ts
await expect(requestAdvisorMessage(openingInput)).resolves.toEqual({
  id: "advisor-summary-1",
  content:
    "根据目前的情况，我把这个项目评为 A 级。\n\n建议先验证复购。",
});
expect(repository.appendMessage).not.toHaveBeenCalled();
~~~

For a hook follow-up, assert the user is saved once with stage advisory, the assistant uses kind chat, and fetcher calls only /api/advisor. Opening-summary persistence belongs to the waiting-page orchestration in Task 5.

- [ ] **Step 2: Run the tests and verify RED**

~~~powershell
npm.cmd test -- lib/advisor/advisor-client.test.ts lib/advisor/use-advisor-session.test.tsx
~~~

Expected: FAIL because the client and hook do not exist.

- [ ] **Step 3: Implement completion-only persistence**

Expose:

~~~ts
export interface AdvisorStreamResult {
  id: string;
  content: string;
}

export async function requestAdvisorMessage(input: {
  fetcher: typeof fetch;
  mode: AdvisorMode;
  context: AdvisorContext;
  messages: MessageRecord[];
  signal: AbortSignal;
  onDelta: (draft: string) => void;
}): Promise<AdvisorStreamResult>;
~~~

Build JSON from advisory messages only, call /api/advisor, read with readChatStream(), update onDelta for each delta, and return only on complete. Throw a typed safe error for HTTP, stream, and SSE error events.

The hook loads one workspace, filters with isAdvisoryMessage, exposes send(text), retry(), and stop(), appends the user before the request, appends the assistant only after completion, and retains the exact failed submission for retry.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS; no partial assistant message is persisted and retry does not duplicate the user message.

- [ ] **Step 5: Commit the client session**

~~~powershell
git add lib/advisor/advisor-client.ts lib/advisor/advisor-client.test.ts lib/advisor/use-advisor-session.ts lib/advisor/use-advisor-session.test.tsx
git commit -m "feat: persist advisor conversations"
~~~

### Task 5: Move finalization into the independent waiting route

**Files:**
- Create: components/research/research-progress.tsx
- Create: components/research/research-progress.test.tsx
- Create: components/research/research-handoff-screen.tsx
- Create: components/research/research-handoff-screen.test.tsx
- Create: app/research/[projectId]/page.tsx
- Create: app/research/[projectId]/page.test.tsx

- [ ] **Step 1: Invoke frontend design guidance and write failing waiting-page tests**

Read C:\Users\78575\.codex\skills\frontend-design\SKILL.md completely before UI code. With a fake repository and streamed responses, assert:

~~~ts
expect(
  screen.getByRole("heading", { name: "正在调研你的项目" }),
).toBeVisible();
expect(screen.getByText("联网收集市场证据")).toHaveAttribute(
  "aria-current",
  "step",
);
expect(fetcher).toHaveBeenCalledWith("/api/finalize", expect.any(Object));
expect(fetcher).toHaveBeenCalledWith("/api/advisor", expect.any(Object));
expect(router.replace).toHaveBeenCalledWith("/advisor/project-1");
~~~

Add recovery cases: existing report plus no summary calls only /api/advisor; existing report plus summary redirects without an API; unavailable research shows “重新调研” and “仅依据访谈继续”.

- [ ] **Step 2: Run the tests and verify RED**

~~~powershell
npm.cmd test -- components/research/research-progress.test.tsx components/research/research-handoff-screen.test.tsx app/research/[projectId]/page.test.tsx
~~~

Expected: FAIL because the route and components do not exist.

- [ ] **Step 3: Implement the recoverable handoff**

Render actual phases:

~~~ts
type ResearchHandoffPhase =
  | "planning_research"
  | "researching"
  | "analyzing"
  | "scoring"
  | "saving"
  | "preparing_advice";
~~~

On mount, load the workspace once. If a summary exists, replace the route. If no report exists, load the project into useAssessmentSession() and call finalizeCurrent(). Reload the workspace after a successful save; if no summary exists, call requestAdvisorMessage() in opening mode and persist exactly this record before router.replace():

~~~ts
const summaryMessage: MessageRecord = {
  id: result.id,
  projectId,
  role: "assistant",
  content: result.content,
  round: 0,
  createdAt: new Date().toISOString(),
  stage: "advisory",
  kind: "advisor_summary",
};
await repository.appendMessage(summaryMessage);
router.replace("/advisor/" + encodeURIComponent(projectId));
~~~

Use a ref guard so Strict Mode cannot duplicate orchestration. Retry buttons call the first incomplete stage explicitly and do not depend on an effect toggling back to ready.

Use Next.js 16 async params:

~~~tsx
export default async function ResearchPage({
  params,
}: PageProps<"/research/[projectId]">) {
  const { projectId } = await params;
  return <ResearchHandoffScreen projectId={projectId} />;
}
~~~

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS; each persisted artifact skips only the stages it proves complete.

- [ ] **Step 5: Commit the waiting route**

~~~powershell
git add components/research/research-progress.tsx components/research/research-progress.test.tsx components/research/research-handoff-screen.tsx components/research/research-handoff-screen.test.tsx app/research/[projectId]/page.tsx app/research/[projectId]/page.test.tsx
git commit -m "feat: add recoverable research handoff"
~~~

### Task 6: Make the A workspace interview-only

**Files:**
- Modify: app/page.tsx
- Modify: components/workspace/project-workspace.tsx
- Modify: components/workspace/project-workspace.test.tsx
- Modify: components/workspace/conversation-panel.tsx
- Delete: components/workspace/finalization-progress.tsx
- Delete: components/workspace/finalization-progress.test.tsx

- [ ] **Step 1: Write failing A-page tests**

Assert the page says “阶段 1 · 信息收集智能体”, filters advisory messages, contains no “报告生成进度”, and navigates instead of finalizing inline:

~~~ts
await user.click(
  screen.getByRole("button", { name: "结束信息收集并开始调研" }),
);

expect(router.push).toHaveBeenCalledWith("/research/project-1");
expect(fetcher).not.toHaveBeenCalledWith("/api/finalize", expect.anything());
expect(
  screen.queryByText("根据目前的情况，我把这个项目评为 A 级。"),
).not.toBeInTheDocument();
~~~

Also assert selecting a final project pushes /advisor/[projectId], while /?projectId=project-1 loads that draft through the A workspace.

- [ ] **Step 2: Run the tests and verify RED**

~~~powershell
npm.cmd test -- components/workspace/project-workspace.test.tsx app/page.test.tsx
~~~

Expected: FAIL because finalization remains embedded in A.

- [ ] **Step 3: Remove embedded finalization and route by project state**

Make app/page.tsx accept an optional projectId search parameter and pass it as initialProjectId to ProjectWorkspace. On first render, the workspace loads that local draft once. Filter panel messages with isInterviewMessage. Replace finalizeReport() with:

~~~ts
function beginResearch(): void {
  if (!state.project) return;
  router.push("/research/" + encodeURIComponent(state.project.id));
}
~~~

Change the button label, remove FinalizationProgress, and change project selection:

~~~ts
if (project.status === "final") {
  router.push("/advisor/" + encodeURIComponent(project.id));
} else {
  void session.loadProject(project.id);
}
~~~

Delete only the now-orphaned inline progress component and test.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS; A never starts /api/finalize itself.

- [ ] **Step 5: Commit the A-page split**

~~~powershell
git add app/page.tsx components/workspace/project-workspace.tsx components/workspace/project-workspace.test.tsx components/workspace/conversation-panel.tsx
git rm components/workspace/finalization-progress.tsx components/workspace/finalization-progress.test.tsx
git commit -m "feat: keep interview workspace focused"
~~~

### Task 7: Build the B advisor summary and conversation page

**Files:**
- Create: components/advisor/advisor-summary.tsx
- Create: components/advisor/advisor-summary.test.tsx
- Create: components/advisor/advisor-conversation.tsx
- Create: components/advisor/advisor-screen.tsx
- Create: components/advisor/advisor-screen.test.tsx
- Create: app/advisor/[projectId]/page.tsx
- Create: app/advisor/[projectId]/page.test.tsx
- Modify: app/globals.css

- [ ] **Step 1: Write failing B-page tests**

Render an A-grade final workspace with one advisor_summary and assert:

~~~ts
expect(
  screen.getByText(/^根据目前的情况，我把这个项目评为 A 级。/),
).toBeVisible();
expect(screen.getByText("78 分")).toBeVisible();
expect(screen.getByText("证据置信度 80%")).toBeVisible();
expect(screen.getAllByTestId("advisor-dimension")).toHaveLength(7);
expect(
  screen.getByRole("link", { name: "市场调研报告" }),
).toHaveAttribute("href", "https://example.com/market-report");
expect(screen.getByRole("button", { name: "导出 PDF" })).toBeVisible();
~~~

Assert interview messages are absent, advisory follow-ups are present, submitting “为什么不是 S 级？” calls /api/advisor, and /api/finalize is never called. Missing report or summary routes to /research/[projectId]; a missing project shows “项目不存在或已被删除” and a link back to /.

- [ ] **Step 2: Run the tests and verify RED**

~~~powershell
npm.cmd test -- components/advisor/advisor-summary.test.tsx components/advisor/advisor-screen.test.tsx app/advisor/[projectId]/page.test.tsx
~~~

Expected: FAIL because B does not exist.

- [ ] **Step 3: Implement the report-shaped first message and normal follow-ups**

Use advisor_summary.content as the introduction. Render the immutable FinalReportRecord underneath with: 综合判断、市场调研结论、项目机会、核心风险、建议立即执行的行动、评级依据、调研来源. Use report.assessmentSnapshot.scored for grade, total, confidence, and dimensions; never parse values from prose.

Reuse a strict safe URL rule:

~~~ts
function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
~~~

AdvisorConversation renders only isAdvisoryMessage results, treats advisor_summary as the rich first message, and renders later messages as ordinary bubbles. The composer label is “继续和建议智能体讨论”. The header reads “阶段 2 · 项目建议智能体”. AdvisorSummary keeps the existing print behavior through a “导出 PDF” button that calls window.print(). AdvisorScreen loads ProjectList; selecting a final project navigates to its advisor route, while selecting an unfinished project navigates to /?projectId= plus the encoded id so Task 6 restores it in A. Preserve focus, live status, reduced motion, the 240px project index on desktop, and the mobile drawer.

Create the async-param page exactly like the research route.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS; visible grade and evidence always come from the saved report.

- [ ] **Step 5: Commit the B page**

~~~powershell
git add components/advisor/advisor-summary.tsx components/advisor/advisor-summary.test.tsx components/advisor/advisor-conversation.tsx components/advisor/advisor-screen.tsx components/advisor/advisor-screen.test.tsx app/advisor/[projectId]/page.tsx app/advisor/[projectId]/page.test.tsx app/globals.css
git commit -m "feat: add conversational advisor report"
~~~

### Task 8: Redirect the legacy report and verify the full journey

**Files:**
- Modify: app/report/[projectId]/page.tsx
- Create or modify: app/report/[projectId]/page.test.tsx
- Delete: components/report/report-screen.tsx
- Delete: components/report/report-view.tsx
- Delete: components/report/report-view.test.tsx
- Modify: e2e/assessment-flow.spec.ts
- Modify: README.md

- [ ] **Step 1: Write failing legacy-route and browser tests**

Test the redirect:

~~~ts
expect(redirect).toHaveBeenCalledWith("/advisor/project-1");
~~~

Update Playwright:

~~~ts
await page
  .getByRole("button", { name: "结束信息收集并开始调研" })
  .click();
await page.waitForURL(/\/research\//);
await expect(page.getByText("联网收集市场证据")).toBeVisible();
await page.waitForURL(/\/advisor\//);
await expect(
  page.getByText(/^根据目前的情况，我把这个项目评为 A 级。/),
).toBeVisible();
await page
  .getByLabel("继续和建议智能体讨论")
  .fill("为什么不是 S 级？");
await page.getByRole("button", { name: "发送" }).click();
await expect(
  page.getByText("当前证据仍缺少稳定复购数据。"),
).toBeVisible();
~~~

Assert one /api/finalize, at least two /api/advisor calls, and no /api/analyze.

- [ ] **Step 2: Run focused tests and verify RED**

~~~powershell
npm.cmd test -- app/report/[projectId]/page.test.tsx
npm.cmd run e2e
~~~

Expected: FAIL because the legacy report still renders and the browser flow still expects /report.

- [ ] **Step 3: Redirect, remove new orphans, and document the flow**

Replace the page:

~~~tsx
import { redirect } from "next/navigation";

export default async function ReportPage({
  params,
}: PageProps<"/report/[projectId]">) {
  const { projectId } = await params;
  redirect("/advisor/" + encodeURIComponent(projectId));
}
~~~

Remove report screen/view only after rg "ReportScreen|ReportView" shows no imports. Update README’s flow to “信息收集 → 独立调研等待 → 建议智能体总结与对话” and document that B follow-ups use saved research without silently recalculating the grade.

- [ ] **Step 4: Run the complete verification gate**

~~~powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run security:client
npm.cmd run e2e
git diff --check
~~~

Expected: every command exits 0; Vitest and Playwright report zero failures; build lists /research/[projectId] and /advisor/[projectId]; the security scan reports no client secret exposure.

- [ ] **Step 5: Review scope and commit the journey**

~~~powershell
git status --short
git diff --check
git add app/report/[projectId]/page.tsx app/report/[projectId]/page.test.tsx e2e/assessment-flow.spec.ts README.md
git rm components/report/report-screen.tsx components/report/report-view.tsx components/report/report-view.test.tsx
git commit -m "test: cover two-agent project journey"
~~~

Expected: only files named in this plan are changed, with no .env.local, .next, test artifacts, or unrelated workspace files staged.
