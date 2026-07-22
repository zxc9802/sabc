# Research, Advisor Chat, and On-Demand Final Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a four-stage workflow where research creates only a provisional assessment, the second agent continues as normal chat, and the final report is generated only after the user clicks the report action.

**Architecture:** Separate the persisted research assessment from `FinalReportRecord`, build advisor context from that assessment and the saved research snapshot, and move final structured analysis/report creation behind a dedicated streamed `/api/report` request. Use one shared stage rail across interview, research, advisor, and report pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Dexie/IndexedDB, Zod, SSE, Vitest + Testing Library, Playwright, Tailwind CSS 4.

---

## Required Next.js references

Read these bundled, version-matched guides completely before editing:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`

## File responsibility map

- `lib/workspace/use-assessment-session.ts`: interview and research orchestration; persist only research assessment.
- `lib/workspace/workspace-reducer.ts`: real research queries, snapshot, assessment, and progress.
- `lib/storage/project-repository.ts`: workflow status and atomic latest-report replacement.
- `components/workflow/stage-rail.tsx`: shared four-stage visual rail.
- `components/research/research-progress.tsx`: actual queries, source count, and research progress.
- `lib/advisor/advisor-context.ts`: bounded context from assessment plus research snapshot.
- `lib/advisor/advisor-prompt.ts`: conversational rating, reasons, and one next question.
- `lib/advisor/use-advisor-session.ts`: report-free advisory chat state and persistence.
- `lib/report/stage-assessment-context.ts`: compact research-assessment context for final analysis.
- `lib/report/final-report-stream.ts`: final-report SSE protocol.
- `app/api/report/route.ts`: no-search final analysis using both conversations.
- `lib/report/use-final-report-generation.ts`: explicit generation, atomic save, and save-only retry.
- `components/report/report-screen.tsx`: report loading and recovery.
- `components/report/report-view.tsx`: complete report and PDF presentation.
- `lib/workflow/project-destination.ts`: stage-aware historical project routing.

### Task 1: Stop research from creating a final report

**Files:**
- Modify: `lib/workspace/use-assessment-session.test.tsx`
- Modify: `lib/workspace/use-assessment-session.ts`
- Modify: `lib/storage/project-repository.test.ts`
- Modify: `lib/storage/project-repository.ts`
- Modify: `components/research/research-handoff-screen.test.tsx`
- Modify: `components/research/research-handoff-screen.tsx`

- [ ] **Step 1: Write failing research-only persistence tests**

Add these expectations after the research SSE completes:

```ts
expect(repository.saveAssessment).toHaveBeenCalledWith(
  expect.objectContaining({ projectId: project.id }),
);
expect(repository.saveFinalization).not.toHaveBeenCalled();
expect(result.current.state.currentAssessment).not.toBeNull();
expect(result.current.state.report).toBeNull();
```

Require project workflow status and advisor navigation:

```ts
await repository.saveAssessment(finalAssessment);
expect((await database.projects.get(project.id))?.status).toBe("provisional");
expect(await database.reports.count()).toBe(0);

expect(workspace.assessments).toHaveLength(1);
expect(workspace.report).toBeNull();
expect(navigation.replace).toHaveBeenCalledWith("/advisor/project-1");
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- lib/workspace/use-assessment-session.test.tsx lib/storage/project-repository.test.ts components/research/research-handoff-screen.test.tsx
```

Expected: FAIL because `finalizeCurrent()` still constructs a report and the handoff requires `workspace.report`.

- [ ] **Step 3: Implement assessment-only persistence**

Remove `createReportContent` and `FinalReportRecord` from the research session. Replace the pending finalization shape with:

```ts
type PendingSave =
  | { kind: "message"; message: MessageRecord }
  | { kind: "assessment"; assessment: AssessmentRecord };
```

After `requireAssessment(assessment)`, run:

```ts
const researchAssessment = requireAssessment(assessment);
dispatch({ type: "FINALIZATION_SAVE_STARTED", requestId });
try {
  await repository.saveAssessment(researchAssessment);
} catch {
  pendingSaveRef.current = { kind: "assessment", assessment: researchAssessment };
  dispatch({
    type: "SAVE_FAILED",
    error: storageError(
      "阶段性评估已经生成，但未能保存到本地。请重试保存。",
      "retry_save",
    ),
  });
  return false;
}
pendingSaveRef.current = null;
dispatch({ type: "SAVE_SUCCEEDED" });
```

Update `retrySave()` to call `saveAssessment()`. Make `saveAssessment()` set project status to `provisional`. Make the research handoff use `workspace.assessments.at(-1)` as its success condition and navigate to advisor without checking a report.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with one assessment and no report.

- [ ] **Step 5: Commit**

```powershell
git add lib/workspace/use-assessment-session.test.tsx lib/workspace/use-assessment-session.ts lib/storage/project-repository.test.ts lib/storage/project-repository.ts components/research/research-handoff-screen.test.tsx components/research/research-handoff-screen.tsx
git commit -m "fix: separate research assessment from final report"
```

### Task 2: Show real research work and the shared stage rail

**Files:**
- Create: `components/workflow/stage-rail.tsx`
- Create: `components/workflow/stage-rail.test.tsx`
- Modify: `lib/workspace/workspace-reducer.ts`
- Modify: `lib/workspace/workspace-reducer.test.ts`
- Modify: `lib/workspace/use-assessment-session.ts`
- Modify: `components/research/research-progress.tsx`
- Modify: `components/research/research-progress.test.tsx`
- Modify: `components/research/research-handoff-screen.tsx`

- [ ] **Step 1: Write failing rail and progress tests**

```tsx
render(<StageRail active="research" />);
expect(screen.getByText("信息访谈")).toHaveAttribute("data-state", "complete");
expect(screen.getByText("联网调研")).toHaveAttribute("aria-current", "step");
expect(screen.getByText("评估讨论")).toHaveAttribute("data-state", "pending");
expect(screen.getByText("最终报告")).toHaveAttribute("data-state", "pending");
```

```ts
const next = workspaceReducer(started, {
  type: "RESEARCH_PLANNED",
  requestId: "finalize-1",
  queries: ["新加坡口红 市场规模"],
});
expect(next.researchQueries).toEqual(["新加坡口红 市场规模"]);
```

```tsx
render(
  <ResearchProgress
    phase="researching"
    queries={["新加坡口红 市场规模"]}
    sourceCount={4}
    error={null}
    onRetry={vi.fn()}
    onInterviewOnly={vi.fn()}
  />,
);
expect(screen.getByText("新加坡口红 市场规模")).toBeVisible();
expect(screen.getByText("已收集 4 个公开来源")).toBeVisible();
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- components/workflow/stage-rail.test.tsx lib/workspace/workspace-reducer.test.ts components/research/research-progress.test.tsx
```

Expected: FAIL because the rail, `researchQueries`, and progress props do not exist.

- [ ] **Step 3: Implement the rail and research details**

```ts
export type WorkflowStage = "interview" | "research" | "advisor" | "report";
const stages = [
  { key: "interview", label: "信息访谈" },
  { key: "research", label: "联网调研" },
  { key: "advisor", label: "评估讨论" },
  { key: "report", label: "最终报告" },
] as const;
```

Add `researchQueries: string[]` to reducer state, initialize it to `[]`, load it from the snapshot, and handle `RESEARCH_PLANNED`. Dispatch that action for `research_plan`. Pass queries and `researchSnapshot?.sources.length ?? 0` to `ResearchProgress`, render them below the real five-step research track, and place `<StageRail active="research" />` above it.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with real query and source data.

- [ ] **Step 5: Commit**

```powershell
git add components/workflow/stage-rail.tsx components/workflow/stage-rail.test.tsx lib/workspace/workspace-reducer.ts lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.ts components/research/research-progress.tsx components/research/research-progress.test.tsx components/research/research-handoff-screen.tsx
git commit -m "feat: show real research handoff progress"
```

### Task 3: Make the advisor contract provisional and conversational

**Files:**
- Modify: `lib/advisor/advisor-context.test.ts`
- Modify: `lib/advisor/advisor-context.ts`
- Modify: `lib/advisor/advisor-prompt.test.ts`
- Modify: `lib/advisor/advisor-prompt.ts`
- Modify: `app/api/advisor/route.test.ts`
- Modify: `app/api/advisor/route.ts`

- [ ] **Step 1: Write failing advisor contract tests**

```ts
const context = createAdvisorContext(project, assessment, researchSnapshot);
expect(context).toMatchObject({
  grade: "A",
  totalScore: 78,
  confidence: 80,
  researchStatus: "completed",
});
expect(context).not.toHaveProperty("report");
```

```ts
expect(createAdvisorOpeningPrefix("A")).toBe(
  "根据调研，目前建议将这个项目评为 A 级。\n\n",
);
expect(buildAdvisorSystemPrompt("opening")).toContain("只提出一个最关键的问题");
expect(buildAdvisorSystemPrompt("reply")).toContain("可以调整建议等级");
expect(buildAdvisorSystemPrompt("reply")).toContain(
  "信息充分时可以建议用户生成最终报告，但不得代替用户触发",
);
expect(buildAdvisorSystemPrompt("reply")).not.toContain("不得重新计算或修改等级");
```

Update route tests to send the report-free context and expect the new deterministic prefix.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- lib/advisor/advisor-context.test.ts lib/advisor/advisor-prompt.test.ts app/api/advisor/route.test.ts
```

Expected: FAIL because advisor context requires `FinalReportRecord` and the grade is immutable.

- [ ] **Step 3: Implement report-free advisor context and prompts**

Use this signature:

```ts
export function createAdvisorContext(
  project: ProjectRecord,
  assessment: AssessmentRecord,
  researchSnapshot: ResearchSnapshotRecord | null,
): AdvisorContext
```

Keep bounded project data, grade, score, confidence, seven dimensions, research status, and safe sources; remove `ReportContent`. Update route Zod schema exactly. Opening mode must explain the provisional rating and ask one question. Reply mode may revise the recommendation when new facts justify it, but must not output a complete report or claim one was generated.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with conversational, mutable advice.

- [ ] **Step 5: Commit**

```powershell
git add lib/advisor/advisor-context.test.ts lib/advisor/advisor-context.ts lib/advisor/advisor-prompt.test.ts lib/advisor/advisor-prompt.ts app/api/advisor/route.test.ts app/api/advisor/route.ts
git commit -m "feat: make advisor rating conversational"
```

### Task 4: Render the second agent as ordinary chat

**Files:**
- Modify: `lib/advisor/use-advisor-session.test.tsx`
- Modify: `lib/advisor/use-advisor-session.ts`
- Modify: `components/advisor/advisor-conversation.tsx`
- Modify: `components/advisor/advisor-screen.test.tsx`
- Modify: `components/advisor/advisor-screen.tsx`
- Modify: `lib/conversation/message-stage.test.ts`
- Modify: `lib/conversation/message-stage.ts`

- [ ] **Step 1: Write failing ordinary-chat tests**

```ts
const workspace = createWorkspace({ assessment, report: null, advisory: [] });
const { result } = renderHook(() =>
  useAdvisorSession({ projectId: project.id, repository, fetcher }),
);
await waitFor(() => expect(result.current.phase).toBe("ready"));
expect(repository.appendMessage).toHaveBeenCalledWith(
  expect.objectContaining({ stage: "advisory", kind: "chat" }),
);
```

```tsx
expect(await screen.findByText(/根据调研，目前建议/)).toBeVisible();
expect(screen.queryByLabelText("报告等级")).not.toBeInTheDocument();
expect(screen.queryByText("评级依据")).not.toBeInTheDocument();
expect(screen.queryByText("导出 PDF")).not.toBeInTheDocument();
```

Add a test proving a legacy `advisor_summary` is rendered as a normal advisory assistant message.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- lib/advisor/use-advisor-session.test.tsx components/advisor/advisor-screen.test.tsx lib/conversation/message-stage.test.ts
```

Expected: FAIL because the session requires `workspace.report` and `AdvisorConversation` renders `AdvisorSummary`.

- [ ] **Step 3: Implement report-free chat state**

```ts
interface AdvisorSessionState {
  phase: AdvisorSessionPhase;
  project: ProjectRecord | null;
  assessment: AssessmentRecord | null;
  researchSnapshot: ResearchSnapshotRecord | null;
  messages: MessageRecord[];
  streamDraft: string;
  error: AdvisorSessionError | null;
}
```

Create an opening only when there are no advisory messages and save it with `kind: "chat"`. Render all advisory records through the same user/assistant bubble loop, including legacy summaries. Remove the report card from advisor, add `<StageRail active="advisor" />`, and route to research only when the assessment is missing.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with a normal second-agent conversation.

- [ ] **Step 5: Commit**

```powershell
git add lib/advisor/use-advisor-session.test.tsx lib/advisor/use-advisor-session.ts components/advisor/advisor-conversation.tsx components/advisor/advisor-screen.test.tsx components/advisor/advisor-screen.tsx lib/conversation/message-stage.test.ts lib/conversation/message-stage.ts
git commit -m "feat: make second agent a chat workspace"
```

### Task 5: Add a no-search final-report stream

**Files:**
- Create: `lib/report/stage-assessment-context.ts`
- Create: `lib/report/stage-assessment-context.test.ts`
- Create: `lib/report/final-report-stream.ts`
- Create: `lib/report/final-report-stream.test.ts`
- Create: `app/api/report/route.ts`
- Create: `app/api/report/route.test.ts`
- Modify: `lib/assessment/analyze-project.ts`
- Modify: `lib/assessment/analyze-project.test.ts`
- Modify: `lib/report/create-report-content.ts`
- Modify: `lib/report/create-report-content.test.ts`

- [ ] **Step 1: Write failing final-report contract tests**

```ts
const context = createStageAssessmentContext(assessment);
expect(context).toMatchObject({ grade: "A", totalScore: 78, confidence: 80 });
expect(context.dimensions).toHaveLength(7);
```

```ts
const frames = [
  encodeFinalReportStreamEvent({ type: "status", stage: "analyzing" }),
  encodeFinalReportStreamEvent({ type: "status", stage: "scoring" }),
  encodeFinalReportStreamEvent({ type: "assessment", result: finalResult }),
  encodeFinalReportStreamEvent({ type: "complete" }),
].join("");
expect(await collectFinalReportEvents(frames)).toHaveLength(4);
```

In route tests, send interview messages, advisory messages, saved research, and the stage assessment. Assert the stream returns `analyzing`, `scoring`, `assessment`, and `complete`, and that no AnySearch client is imported or called. Require report conversation summaries to contain both “AI 访谈员” and “项目建议智能体”.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- lib/report/stage-assessment-context.test.ts lib/report/final-report-stream.test.ts app/api/report/route.test.ts lib/assessment/analyze-project.test.ts lib/report/create-report-content.test.ts
```

Expected: FAIL because the new report context, stream, route, and advisory summary support do not exist.

- [ ] **Step 3: Implement the final report route**

Add `stageAssessment?: StageAssessmentContext` to `AnalyzeProjectInput` and serialize it in `buildAnalysisData()`. Strictly validate this request:

```ts
{
  projectId: string;
  projectDescription: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    round: number;
    stage: "interview" | "advisory";
  }>;
  interviewDepth: "low" | "medium" | "high";
  researchSnapshot: ResearchSnapshotRecord;
  stageAssessment: StageAssessmentContext;
}
```

Map both stages into `analyzeProject()`, call it with `final: true`, saved research, and stage assessment, and emit only safe SSE errors. Do not import AnySearch. Update `createReportContent()` to label both interview and advisor messages instead of filtering advisory messages out.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with a no-search report analysis.

- [ ] **Step 5: Commit**

```powershell
git add lib/report/stage-assessment-context.ts lib/report/stage-assessment-context.test.ts lib/report/final-report-stream.ts lib/report/final-report-stream.test.ts app/api/report/route.ts app/api/report/route.test.ts lib/assessment/analyze-project.ts lib/assessment/analyze-project.test.ts lib/report/create-report-content.ts lib/report/create-report-content.test.ts
git commit -m "feat: generate final analysis on demand"
```

### Task 6: Add the explicit report action and atomic overwrite

**Files:**
- Create: `lib/report/use-final-report-generation.ts`
- Create: `lib/report/use-final-report-generation.test.tsx`
- Modify: `lib/storage/project-repository.ts`
- Modify: `lib/storage/project-repository.test.ts`
- Modify: `components/advisor/advisor-conversation.tsx`
- Modify: `components/advisor/advisor-screen.tsx`
- Modify: `components/advisor/advisor-screen.test.tsx`

- [ ] **Step 1: Write failing click, failure, and overwrite tests**

```ts
expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/report");
await user.click(screen.getByRole("button", { name: "生成最终报告" }));
expect(fetcher).toHaveBeenCalledWith("/api/report", expect.any(Object));
await waitFor(() =>
  expect(navigation.push).toHaveBeenCalledWith("/report/project-1"),
);
```

```ts
expect(result.current.error?.code).toBe("provider_timeout");
expect(repository.saveFinalization).not.toHaveBeenCalled();
expect(navigation.push).not.toHaveBeenCalled();
```

```ts
await repository.saveFinalization(newAssessment, newReport);
expect(await database.reports.where("projectId").equals(project.id).count()).toBe(1);
expect((await database.reports.toArray())[0].id).toBe(newReport.id);
expect((await database.projects.get(project.id))?.status).toBe("final");
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- lib/report/use-final-report-generation.test.tsx lib/storage/project-repository.test.ts components/advisor/advisor-screen.test.tsx
```

Expected: FAIL because no explicit report hook/action exists and reports are appended.

- [ ] **Step 3: Implement user-controlled generation**

Expose:

```ts
export function useFinalReportGeneration(options: {
  projectId: string;
  repository: ProjectRepository;
  fetcher?: typeof fetch;
}): {
  phase: "idle" | "analyzing" | "scoring" | "saving";
  error: FinalReportGenerationError | null;
  generate(): Promise<boolean>;
  retrySave(): Promise<boolean>;
}
```

Load workspace on click, combine both message stages, call `/api/report`, construct `AssessmentRecord` and `FinalReportRecord`, then save them. Keep complete records in a ref when storage fails so retry repeats only the transaction.

Within the repository transaction, delete existing reports for the project, add the new report, and set project status to `final`. Add “生成最终报告” next to “发送”, disable duplicate actions while busy, show real status/error text, and navigate only after save succeeds.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with click-only generation and one latest report.

- [ ] **Step 5: Commit**

```powershell
git add lib/report/use-final-report-generation.ts lib/report/use-final-report-generation.test.tsx lib/storage/project-repository.ts lib/storage/project-repository.test.ts components/advisor/advisor-conversation.tsx components/advisor/advisor-screen.tsx components/advisor/advisor-screen.test.tsx
git commit -m "feat: generate final report on user action"
```

### Task 7: Restore a dedicated final report page

**Files:**
- Create: `components/report/report-screen.tsx`
- Create: `components/report/report-screen.test.tsx`
- Create: `components/report/report-view.tsx`
- Create: `components/report/report-view.test.tsx`
- Modify: `app/report/[projectId]/page.tsx`
- Modify: `app/report/[projectId]/page.test.tsx`
- Delete: `components/advisor/advisor-summary.tsx`
- Delete: `components/advisor/advisor-summary.test.tsx`

- [ ] **Step 1: Write failing report-page tests**

```tsx
const output = await ReportPage({
  params: Promise.resolve({ projectId: "project-1" }),
} as PageProps<"/report/[projectId]">);
render(output);
expect(screen.getByTestId("report-screen")).toHaveAttribute(
  "data-project-id",
  "project-1",
);
```

```tsx
expect(await screen.findByLabelText("报告等级")).toHaveTextContent("A");
expect(screen.getAllByTestId("report-dimension")).toHaveLength(7);
expect(screen.getByRole("link", { name: "返回第二智能体继续讨论" })).toHaveAttribute(
  "href",
  "/advisor/project-1",
);
expect(screen.getByRole("button", { name: "导出 PDF" })).toBeVisible();
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- app/report/[projectId]/page.test.tsx components/report/report-screen.test.tsx components/report/report-view.test.tsx
```

Expected: FAIL because `/report` redirects and the report components do not exist.

- [ ] **Step 3: Implement report route and components**

```tsx
export default async function ReportPage({
  params,
}: PageProps<"/report/[projectId]">) {
  const { projectId } = await params;
  return <ReportScreen projectId={projectId} />;
}
```

`ReportScreen` loads the workspace, renders not-found/report-missing recovery, and includes `<StageRail active="report" />`. `ReportView` renders grade, total/confidence, seven dimensions, decision summary, sources, risks, actions, safe URLs, PDF, and return-to-chat. Move report presentation out of `AdvisorSummary`, then delete that advisor filename and test.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command again. Expected: PASS with a real report route.

- [ ] **Step 5: Commit**

```powershell
git add app/report/[projectId]/page.tsx app/report/[projectId]/page.test.tsx components/report/report-screen.tsx components/report/report-screen.test.tsx components/report/report-view.tsx components/report/report-view.test.tsx components/advisor/advisor-summary.tsx components/advisor/advisor-summary.test.tsx
git commit -m "feat: restore on-demand final report page"
```

### Task 8: Align navigation, all-stage UI, E2E, and documentation

**Files:**
- Create: `lib/workflow/project-destination.ts`
- Create: `lib/workflow/project-destination.test.ts`
- Modify: `lib/storage/project-repository.ts`
- Modify: `components/workspace/project-workspace.tsx`
- Modify: `components/workspace/project-workspace.test.tsx`
- Modify: `components/advisor/advisor-screen.tsx`
- Modify: `components/advisor/advisor-screen.test.tsx`
- Modify: `README.md`
- Modify: `e2e/assessment-flow.spec.ts`

- [ ] **Step 1: Write failing navigation and E2E expectations**

```ts
expect(projectDestination({ ...project, status: "draft" })).toBe(
  "/?projectId=project-1",
);
expect(projectDestination({ ...project, status: "provisional" })).toBe(
  "/advisor/project-1",
);
expect(projectDestination({ ...project, status: "final" })).toBe(
  "/report/project-1",
);
```

Update E2E with:

```ts
await page.waitForURL(/\/research\//);
await expect(page.getByText("AnySearch 联网搜索")).toBeVisible();
await expect(page.getByText(/已收集 \d+ 个公开来源/)).toBeVisible();
await page.waitForURL(/\/advisor\//);
await expect(page.getByText(/根据调研，目前建议将这个项目评为 A 级/)).toBeVisible();
expect(requests.filter((url) => url.includes("/api/report"))).toHaveLength(0);
await page.getByRole("button", { name: "生成最终报告" }).click();
await page.waitForURL(/\/report\//);
expect(requests.filter((url) => url.includes("/api/report"))).toHaveLength(1);
await page.getByRole("link", { name: "返回第二智能体继续讨论" }).click();
```

- [ ] **Step 2: Run tests and E2E to verify RED**

```powershell
npm.cmd test -- lib/workflow/project-destination.test.ts components/workspace/project-workspace.test.tsx components/advisor/advisor-screen.test.tsx
npm.cmd run e2e
```

Expected: FAIL because status routing, interview rail, report stubs, and return flow are incomplete.

- [ ] **Step 3: Implement navigation and final copy**

```ts
export function projectDestination(project: ProjectRecord): string {
  const id = encodeURIComponent(project.id);
  if (project.status === "final") return `/report/${id}`;
  if (project.status === "provisional") return `/advisor/${id}`;
  return `/?projectId=${id}`;
}
```

Add a repository assertion that project comparison excludes assessment-only work:

```ts
const records = await repository.listFinalAssessments([
  assessedOnly.id,
  reported.id,
]);
expect(records.map(({ project }) => project.id)).toEqual([reported.id]);
expect(records[0].assessment.id).toBe(records[0].report?.assessmentSnapshot.id);
```

Normalize `listProjects()` so legacy projects with reports return `final`, projects with assessments but no report return `provisional`, and untouched projects return `draft`. Make `listFinalAssessments()` skip workspaces without a report and use the report's assessment snapshot. Use the route helper in both sidebars. Add `<StageRail active="interview" />` to the first-agent page. Update README to state:

```text
第一智能体访谈 → AnySearch 联网调研 → 第二智能体评估讨论 → 用户点击后生成最终报告
```

Update E2E stubs so `/api/finalize` produces research plus a provisional assessment, `/api/advisor` produces ordinary chat, and `/api/report` produces a final assessment only after a click. Cover return-to-chat and overwrite generation.

- [ ] **Step 4: Run complete verification**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run security:client
npm.cmd run e2e
git diff --check
```

Expected: all tests pass; build lists the four pages plus `/api/report`; secret scan passes; E2E covers interview, visible research, advisor chat, explicit report generation, return, overwrite, restore, and compare; diff check is clean.

- [ ] **Step 5: Commit**

```powershell
git add lib/workflow/project-destination.ts lib/workflow/project-destination.test.ts lib/storage/project-repository.ts components/workspace/project-workspace.tsx components/workspace/project-workspace.test.tsx components/advisor/advisor-screen.tsx components/advisor/advisor-screen.test.tsx README.md e2e/assessment-flow.spec.ts
git commit -m "test: cover four-stage assessment journey"
```

- [ ] **Step 6: Restart the requested server**

```powershell
npm.cmd run dev -- --port 3001
```

Verify separately:

```powershell
$response = Invoke-WebRequest -Uri 'http://localhost:3001/' -UseBasicParsing -TimeoutSec 10
$response.StatusCode
```

Expected: `200`, with the dev process kept running.
