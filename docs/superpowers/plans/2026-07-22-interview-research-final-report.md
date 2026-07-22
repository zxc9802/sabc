# Continuous Interview, AnySearch Research, and Final Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each interview turn a single fast streaming chat call, then run AnySearch research, one final AI analysis, one deterministic score, and one sourced report only after the user ends the interview.

**Architecture:** Split the current `/api/analyze` two-call loop into `/api/chat` for pure streamed interviewing and `/api/finalize` for a staged research-and-report pipeline. Keep AnySearch and model credentials server-only, persist normalized research snapshots in IndexedDB for retry, and reuse the existing deterministic rubric scorer exactly once after the final structured model result validates.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, TypeScript, Zod 4, Dexie 4, Vitest, Testing Library, Playwright, OpenAI-compatible chat completions, AnySearch JSON-RPC.

---

## File map

- Create `lib/research/research-types.ts`: normalized search query, source, snapshot, and status types.
- Create `lib/research/query-sanitizer.ts`: deterministic removal and rejection of sensitive search material.
- Create `lib/research/anysearch-client.ts`: server-only JSON-RPC client and Markdown result normalization.
- Create `lib/research/research-plan.ts`: validated model-generated public query plan.
- Create `lib/conversation/interview-prompt.ts`: assessment-free interview system and user prompts.
- Create `lib/streaming/chat-stream.ts`: chat SSE encoding and parsing.
- Create `lib/streaming/finalize-stream.ts`: finalization SSE encoding and parsing.
- Create `app/api/chat/route.ts`: one streamed model call per interview turn.
- Create `app/api/finalize/route.ts`: query planning, AnySearch, final model analysis, and one score.
- Create `components/workspace/finalization-progress.tsx`: inline end-stage progress and recovery controls.
- Modify `lib/ai/system-prompt.ts`: final-analysis prompt accepts only provided external sources.
- Modify `lib/assessment/analyze-project.ts`: final mode consumes normalized sources and does not choose a next question.
- Modify `lib/domain/api-types.ts`: separate chat and finalization event contracts.
- Modify `lib/domain/types.ts`: expand research status/source metadata used by reports.
- Modify `lib/storage/db.ts`: Dexie v2 research snapshot table and workspace shape.
- Modify `lib/storage/project-repository.ts`: save/load/delete research snapshots and atomically save final assessment/report.
- Modify `lib/workspace/workspace-reducer.ts`: chat and finalization phases without per-turn assessments.
- Modify `lib/workspace/use-assessment-session.ts`: `/api/chat`, `/api/finalize`, snapshot retry, and final save orchestration.
- Modify `components/workspace/conversation-panel.tsx`: end button, AI-only chat state, and no scoring copy.
- Modify `components/workspace/project-workspace.tsx`: remove live assessment sidebar and launch finalization.
- Modify `app/globals.css`: two-column workspace and finalization progress styling.
- Modify `lib/report/create-report-content.ts` and `components/report/report-view.tsx`: sourced final report and research-state disclosure.
- Modify `.env.example` and `scripts/check-client-secrets.mjs`: document and scan `ANYSEARCH_API_KEY`.
- Delete `components/workspace/assessment-panel.tsx` after all consumers are removed.

### Task 1: Research types and durable snapshot storage

**Files:**
- Create: `lib/research/research-types.ts`
- Modify: `lib/domain/types.ts`
- Modify: `lib/storage/db.ts`
- Modify: `lib/storage/project-repository.ts`
- Test: `lib/storage/project-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests that save a snapshot, reload it with the workspace, overwrite the same project snapshot, delete it with the project, and atomically save an assessment/report pair. Use this record shape:

```ts
const research: ResearchSnapshotRecord = {
  id: "research-project-1",
  projectId: project.id,
  queries: ["跨境电商 2026 市场规模"],
  sources: [{
    title: "Market report",
    url: "https://example.com/report",
    snippet: "The market grew in 2026.",
    query: "跨境电商 2026 市场规模",
  }],
  status: "completed",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm.cmd test -- lib/storage/project-repository.test.ts`

Expected: FAIL because research snapshot types, table, and repository methods do not exist.

- [ ] **Step 3: Add minimal types and Dexie migration**

Define the focused contract:

```ts
export type ResearchStatus = "completed" | "partial" | "unavailable";

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  query: string;
}

export interface ResearchSnapshotRecord {
  id: string;
  projectId: string;
  queries: string[];
  sources: ResearchSource[];
  status: ResearchStatus;
  createdAt: string;
  updatedAt: string;
}
```

Add Dexie version 2 with `researchSnapshots: "id, projectId, updatedAt"`. Add `saveResearchSnapshot`, include the latest snapshot in `getProjectWorkspace`, delete it in the existing project transaction, and add `saveFinalization(assessment, report)` using one Dexie transaction across projects, assessments, evidence, and reports.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- lib/storage/project-repository.test.ts`

Expected: PASS.

Commit:

```powershell
git add lib/research/research-types.ts lib/domain/types.ts lib/storage/db.ts lib/storage/project-repository.ts lib/storage/project-repository.test.ts
git commit -m "feat: persist project research snapshots"
```

### Task 2: AnySearch client and privacy filter

**Files:**
- Create: `lib/research/query-sanitizer.ts`
- Create: `lib/research/query-sanitizer.test.ts`
- Create: `lib/research/anysearch-client.ts`
- Create: `lib/research/anysearch-client.test.ts`
- Modify: `.env.example`
- Modify: `scripts/check-client-secrets.mjs`
- Modify: `scripts/check-client-secrets.test.mjs`

- [ ] **Step 1: Write privacy and protocol tests**

Cover keys (`sk-...`, `as_sk_...`), email, phone, currency amounts, duplicate/empty queries, five-query cap, Authorization header, JSON-RPC payload, timeout, non-2xx response, and Markdown normalization. The request assertion must match:

```ts
expect(JSON.parse(String(init?.body))).toEqual({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "search",
    arguments: { query: "跨境电商 市场规模", max_results: 3 },
  },
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd test -- lib/research/query-sanitizer.test.ts lib/research/anysearch-client.test.ts scripts/check-client-secrets.test.mjs`

Expected: FAIL because the modules and AnySearch scanning rule do not exist.

- [ ] **Step 3: Implement the server-only client**

Use `https://api.anysearch.com/mcp`, `X-Anysearch-Client: sabc/1.0`, optional `Authorization: Bearer ...`, a 30-second abort timeout, one retry for retryable failures, three results per query, and at most five queries. Parse the returned text blocks shaped as `### N. title`, `- **URL**: ...`, and snippet text into `ResearchSource[]`. Reject non-HTTP(S) source URLs.

The sanitizer returns only safe public queries:

```ts
export function sanitizeResearchQueries(values: string[]): string[] {
  return [...new Set(values.map(sanitizeOne).filter(Boolean))].slice(0, 5);
}
```

Add `ANYSEARCH_API_KEY=replace-with-a-newly-rotated-key` to `.env.example`, and update the client secret scanner to test both `DEEPSEEK_API_KEY` and `ANYSEARCH_API_KEY` without logging either value.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- lib/research/query-sanitizer.test.ts lib/research/anysearch-client.test.ts scripts/check-client-secrets.test.mjs`

Expected: PASS.

Commit:

```powershell
git add .env.example scripts/check-client-secrets.mjs scripts/check-client-secrets.test.mjs lib/research/query-sanitizer.ts lib/research/query-sanitizer.test.ts lib/research/anysearch-client.ts lib/research/anysearch-client.test.ts
git commit -m "feat: add secure AnySearch research client"
```

### Task 3: Pure streaming interview API

**Files:**
- Create: `lib/conversation/interview-prompt.ts`
- Create: `lib/conversation/interview-prompt.test.ts`
- Create: `lib/streaming/chat-stream.ts`
- Create: `lib/streaming/chat-stream.test.ts`
- Create: `app/api/chat/route.ts`
- Create: `app/api/chat/route.test.ts`

- [ ] **Step 1: Read the installed Next.js 16 route documentation**

Read:

```powershell
Get-Content node_modules\next\dist\docs\01-app\01-getting-started\15-route-handlers.md -Raw
Get-Content node_modules\next\dist\docs\01-app\03-api-reference\03-file-conventions\route.md -Raw
```

Expected: confirm Web `Request`, `Response`, and `ReadableStream` are the supported route-handler primitives.

- [ ] **Step 2: Write failing prompt, stream, and route tests**

Assert low/medium/high guidance, default medium at callers, one-question behavior, the exact natural end suggestion, absence of score/rating instructions, split UTF-8 SSE parsing, missing configuration, invalid input, and this event order:

```ts
expect(events.map(({ type }) => type)).toEqual([
  "assistant_delta",
  "assistant_delta",
  "complete",
]);
```

Also assert the provider is called once and the stream contains no `assessment` event.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm.cmd test -- lib/conversation/interview-prompt.test.ts lib/streaming/chat-stream.test.ts app/api/chat/route.test.ts`

Expected: FAIL because `/api/chat` and its contracts do not exist.

- [ ] **Step 4: Implement the minimal chat route**

Validate `projectId`, `projectDescription`, `messages`, `interviewDepth`, and `round` with a strict Zod schema. Build one system prompt that asks the model to acknowledge the latest answer, identify the single highest-value gap, ask exactly one question, and use this sentence only when ready:

```text
核心信息已经比较完整，建议结束访谈并开始调研；你也可以继续补充。
```

Call `DeepSeekClient.stream()` once, emit real deltas immediately, emit `complete`, and return safe errors without provider bodies or secrets.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd test -- lib/conversation/interview-prompt.test.ts lib/streaming/chat-stream.test.ts app/api/chat/route.test.ts`

Expected: PASS.

Commit:

```powershell
git add lib/conversation/interview-prompt.ts lib/conversation/interview-prompt.test.ts lib/streaming/chat-stream.ts lib/streaming/chat-stream.test.ts app/api/chat/route.ts app/api/chat/route.test.ts
git commit -m "feat: stream assessment-free interviews"
```

### Task 4: Research planning and sourced final analysis

**Files:**
- Create: `lib/research/research-plan.ts`
- Create: `lib/research/research-plan.test.ts`
- Modify: `lib/ai/analysis-schema.ts`
- Modify: `lib/ai/system-prompt.ts`
- Modify: `lib/assessment/analyze-project.ts`
- Modify: `lib/assessment/analyze-project.test.ts`

- [ ] **Step 1: Write failing final-analysis tests**

Assert that query planning validates `{ queries: string[] }`, sanitizes to five public queries, and that final analysis receives both conversation and actual normalized sources. Add a source allow-list test: a model-provided URL not present in `ResearchSource[]` must be downgraded to `model_inference`, while an exact provided source may remain `external_source` with its URL.

Use an input such as:

```ts
research: {
  status: "completed",
  queries: ["跨境电商 市场规模"],
  sources: [{
    title: "Official market report",
    url: "https://example.com/market",
    snippet: "Market demand increased.",
    query: "跨境电商 市场规模",
  }],
}
```

Assert `nextQuestion === null`, `sources` contains the supplied title/URL, and an injected score function is called exactly once.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd test -- lib/research/research-plan.test.ts lib/assessment/analyze-project.test.ts`

Expected: FAIL because final research input and allow-list behavior are not implemented.

- [ ] **Step 3: Implement final mode**

Add a strict `researchPlanSchema` with one to five queries. Extend the final analysis data with:

```ts
{
  conversation: input.messages,
  externalResearch: input.research.sources,
  researchStatus: input.research.status,
}
```

Update the system prompt so `external_source` is allowed only for a supplied exact URL, user statements remain `user_input`, and missing sources cannot become verified. In final mode, do not run question selection or assessment diff logic; return `nextQuestion: null`, one score, normalized `sources`, and the final research status.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- lib/research/research-plan.test.ts lib/assessment/analyze-project.test.ts lib/ai/system-prompt.test.ts`

Expected: PASS.

Commit:

```powershell
git add lib/research/research-plan.ts lib/research/research-plan.test.ts lib/ai/analysis-schema.ts lib/ai/system-prompt.ts lib/ai/system-prompt.test.ts lib/assessment/analyze-project.ts lib/assessment/analyze-project.test.ts
git commit -m "feat: analyze interviews with researched sources"
```

### Task 5: Finalization SSE route

**Files:**
- Modify: `lib/domain/api-types.ts`
- Create: `lib/streaming/finalize-stream.ts`
- Create: `lib/streaming/finalize-stream.test.ts`
- Create: `app/api/finalize/route.ts`
- Create: `app/api/finalize/route.test.ts`

- [ ] **Step 1: Write failing stream and route tests**

Test fresh research and snapshot reuse. For fresh research, assert the route emits:

```ts
[
  { type: "status", stage: "planning_research" },
  { type: "research_plan", queries: expect.any(Array) },
  { type: "status", stage: "researching" },
  { type: "research_complete", snapshot: expect.any(Object) },
  { type: "status", stage: "analyzing" },
  { type: "status", stage: "scoring" },
  { type: "assessment", result: expect.any(Object) },
  { type: "complete" },
]
```

Capture the final provider request and assert it contains a real AnySearch title, snippet, and URL. Also cover invalid snapshots, AnySearch retry/failure, partial results, missing configuration, safe error events, and `researchMode: "interview_only"`, which creates an `unavailable` snapshot without contacting AnySearch.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd test -- lib/streaming/finalize-stream.test.ts app/api/finalize/route.test.ts`

Expected: FAIL because the finalization route does not exist.

- [ ] **Step 3: Implement staged orchestration**

Validate the request, use a valid supplied snapshot or create a plan, run safe queries with the AnySearch client, emit and retain the normalized snapshot, then call final analysis with that exact snapshot. When `researchMode` is `interview_only`, emit an `unavailable` snapshot and analyze only the interview. Emit the only final assessment after analysis and scoring. Do not send full conversation data to AnySearch.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- lib/streaming/finalize-stream.test.ts app/api/finalize/route.test.ts`

Expected: PASS.

Commit:

```powershell
git add lib/domain/api-types.ts lib/streaming/finalize-stream.ts lib/streaming/finalize-stream.test.ts app/api/finalize/route.ts app/api/finalize/route.test.ts
git commit -m "feat: finalize interviews through AnySearch"
```

### Task 6: Client state, retry, and atomic final save

**Files:**
- Modify: `lib/workspace/workspace-reducer.ts`
- Modify: `lib/workspace/workspace-reducer.test.ts`
- Modify: `lib/workspace/use-assessment-session.ts`
- Modify: `lib/workspace/use-assessment-session.test.tsx`

- [ ] **Step 1: Write failing reducer and hook tests**

Replace per-turn assessment expectations with these behaviors: chat deltas appear before completion, no assessment is saved during chat, AI end advice does not change phase, only `finalizeCurrent()` calls `/api/finalize`, `research_complete` persists before assessment handling, final assessment/report save atomically, and retry sends the saved snapshot.

The phase union becomes:

```ts
type WorkspacePhase =
  | "idle" | "loading" | "ready" | "chatting"
  | "planning_research" | "researching" | "analyzing"
  | "scoring" | "saving" | "error";
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd test -- lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.test.tsx`

Expected: FAIL because the reducer and hook still require an assessment before a chat message can complete.

- [ ] **Step 3: Implement the minimal client orchestration**

Change create and answer calls to `/api/chat`. Persist the user message before the request and the completed assistant message afterward. Implement `finalizeCurrent()` with `/api/finalize`, save `research_complete` immediately, build report content from the final assessment and messages, call `repository.saveFinalization()`, and expose retry/fallback state. Remove previous assessment and question-history fields from chat requests.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.test.tsx`

Expected: PASS.

Commit:

```powershell
git add lib/workspace/workspace-reducer.ts lib/workspace/workspace-reducer.test.ts lib/workspace/use-assessment-session.ts lib/workspace/use-assessment-session.test.tsx
git commit -m "feat: separate interview and finalization state"
```

### Task 7: Chat-first workspace UI

**Files:**
- Create: `components/workspace/finalization-progress.tsx`
- Create: `components/workspace/finalization-progress.test.tsx`
- Modify: `components/workspace/conversation-panel.tsx`
- Modify: `components/workspace/project-workspace.tsx`
- Modify: `components/workspace/project-workspace.test.tsx`
- Modify: `app/globals.css`
- Delete: `components/workspace/assessment-panel.tsx`

- [ ] **Step 1: Read the frontend design skill and write failing component tests**

Read `C:\Users\78575\.codex\skills\frontend-design\SKILL.md` completely before changing UI. Test that no live grade/score sidebar appears, conversation spans the main area, the end button is present only for a usable interview, AI advice remains an ordinary message, clicking end starts finalization, stage progress is inline, and failure offers retry plus “仅依据访谈生成报告”.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd test -- components/workspace/finalization-progress.test.tsx components/workspace/project-workspace.test.tsx`

Expected: FAIL because the live assessment panel still owns the end action.

- [ ] **Step 3: Implement the approved layout**

Use the existing dossier visual language, keep the 240px project index, expand conversation into the remaining width, and place a restrained progress rail at the end of the conversation. Label the primary action “结束访谈并开始调研”; do not show total score, grade, confidence, dimension bars, or per-turn evidence changes in the workspace.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd test -- components/workspace/finalization-progress.test.tsx components/workspace/project-workspace.test.tsx app/page.test.tsx`

Expected: PASS.

Commit:

```powershell
git add components/workspace/finalization-progress.tsx components/workspace/finalization-progress.test.tsx components/workspace/conversation-panel.tsx components/workspace/project-workspace.tsx components/workspace/project-workspace.test.tsx app/globals.css
git rm components/workspace/assessment-panel.tsx
git commit -m "feat: make the workspace chat first"
```

### Task 8: Sourced report, route cleanup, and end-to-end coverage

**Files:**
- Modify: `lib/report/create-report-content.ts`
- Modify: `lib/report/create-report-content.test.ts`
- Modify: `components/report/report-view.tsx`
- Modify: `components/report/report-view.test.tsx`
- Modify: `e2e/assessment-flow.spec.ts`
- Modify: `scripts/smoke-stream.mjs`
- Delete: `app/api/analyze/route.ts`
- Delete: `app/api/analyze/route.test.ts`
- Delete: `lib/streaming/analyze-stream.ts`
- Delete: `lib/streaming/analyze-stream.test.ts`
- Delete: `lib/conversation/assistant-reply.ts`
- Delete: `lib/conversation/assistant-reply.test.ts`

- [ ] **Step 1: Write failing report and browser tests**

Assert the report distinguishes user statements from external evidence, renders safe clickable source links, discloses `partial` or `unavailable` research, and contains no per-turn assessment. Update Playwright mocks for `/api/chat` and `/api/finalize`, and verify the final model receives a source before the report opens.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm.cmd test -- lib/report/create-report-content.test.ts components/report/report-view.test.tsx`

Expected: FAIL until report content and status disclosure are updated.

- [ ] **Step 3: Implement report updates and remove obsolete flow**

Use `assessment.sources` for the external-evidence section, add clear copy for completed/partial/unavailable research, and preserve existing safe URL handling. Remove the old `/api/analyze`, analyze stream parser, assessment explanation builder, and their tests after all imports are gone. Update the smoke script to exercise `/api/chat` streaming.

- [ ] **Step 4: Run focused and E2E tests, then commit**

Run:

```powershell
npm.cmd test
npm.cmd run e2e
```

Expected: all Vitest and Playwright tests PASS.

Commit:

```powershell
git add lib/report/create-report-content.ts lib/report/create-report-content.test.ts components/report/report-view.tsx components/report/report-view.test.tsx e2e/assessment-flow.spec.ts scripts/smoke-stream.mjs
git rm app/api/analyze/route.ts app/api/analyze/route.test.ts lib/streaming/analyze-stream.ts lib/streaming/analyze-stream.test.ts lib/conversation/assistant-reply.ts lib/conversation/assistant-reply.test.ts
git commit -m "test: cover researched final report flow"
```

### Task 9: Full verification and live smoke

**Files:**
- Modify only files required by failures directly caused by Tasks 1-8.

- [ ] **Step 1: Run the complete automated gate**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run security:client
npm.cmd run e2e
git diff --check
```

Expected: every command exits 0; secret scan reports no client exposure.

- [ ] **Step 2: Run a real provider smoke**

Start the app from `D:\SABC智能体新`, create a project, confirm multiple visible chat deltas arrive without any assessment event, answer at least once, end the interview, confirm AnySearch sources appear before final analysis, and open the final report.

Expected: chat streams immediately relative to the old two-model-call loop; final report contains at least one real source URL when AnySearch succeeds; one final assessment exists for the project.

- [ ] **Step 3: Review the final diff and commit verification-only fixes**

Run:

```powershell
git status --short
git diff --check
git log --oneline -10
```

Expected: no unrelated files and no uncommitted implementation changes. If verification required a scoped fix, commit only that fix with `fix: complete researched finalization verification`.
