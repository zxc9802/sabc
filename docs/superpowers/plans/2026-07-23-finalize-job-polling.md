# Finalize Job Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run final project analysis as a process-local background job and let the browser poll by JobID instead of holding one long SSE request.

**Architecture:** Extract the current finalization pipeline behind an event callback, then feed those events into a process-local registry. A POST route creates a job and returns immediately; a GET route returns immutable job snapshots; the assessment hook polls snapshots and reuses its existing reducer and persistence behavior.

**Tech Stack:** Next.js 16 route handlers, TypeScript, React hooks, Vitest, Testing Library

---

## File Structure

- Create `lib/finalization/run-finalization.ts`: reusable final research/analysis/scoring pipeline that emits existing `FinalizeStreamEvent` values.
- Create `lib/finalization/finalize-job-store.ts`: process-local job lifecycle, event reduction, expiration, and immutable snapshots.
- Create `lib/finalization/finalize-job-store.test.ts`: registry lifecycle and cleanup tests.
- Create `lib/finalization/finalize-request.ts`: shared Zod request schema and environment validation used by both POST routes.
- Create `lib/streaming/finalize-job.ts`: browser-safe job snapshot types and response parser.
- Create `lib/streaming/finalize-job.test.ts`: parser validation tests.
- Create `app/api/finalize-jobs/route.ts`: create-job endpoint.
- Create `app/api/finalize-jobs/route.test.ts`: immediate 202 and validation tests.
- Create `app/api/finalize-jobs/[jobId]/route.ts`: poll endpoint.
- Create `app/api/finalize-jobs/[jobId]/route.test.ts`: snapshot and 404 tests.
- Modify `app/api/finalize/route.ts`: retain SSE compatibility while delegating pipeline execution to the shared runner.
- Modify `app/api/finalize/route.test.ts`: preserve existing pipeline coverage after extraction.
- Modify `lib/workspace/use-assessment-session.ts`: replace finalization SSE consumption with JobID creation and polling.
- Modify `lib/workspace/use-assessment-session.test.tsx`: cover polling completion, failures, and request shape.

### Task 1: Extract the Existing Finalization Pipeline

**Files:**
- Create: `lib/finalization/finalize-request.ts`
- Create: `lib/finalization/run-finalization.ts`
- Modify: `app/api/finalize/route.ts`
- Test: `app/api/finalize/route.test.ts`

- [ ] **Step 1: Add a failing compatibility assertion**

Extend the existing successful route test to assert the response still contains
`Content-Type: text/event-stream` and the exact ordered events:

```ts
expect(response.headers.get("content-type")).toContain("text/event-stream");
expect(events.map(eventLabel)).toEqual([
  "status:planning_research",
  "research_plan",
  "status:researching",
  "research_complete",
  "status:analyzing",
  "status:scoring",
  "assessment",
  "complete",
]);
```

- [ ] **Step 2: Run the focused route test**

Run:

```powershell
npm.cmd test -- app/api/finalize/route.test.ts
```

Expected: PASS, establishing the behavior that the extraction must preserve.

- [ ] **Step 3: Extract the shared request contract**

Move the finalization request Zod schema and inferred `FinalizeRequest` type into
`lib/finalization/finalize-request.ts`. Export:

```ts
export const finalizeRequestSchema = z.strictObject(/* existing fields */);
export type FinalizeRequest = z.infer<typeof finalizeRequestSchema>;
export function hasFinalizeConfiguration(): boolean;
```

Keep all current validation limits and the research-snapshot project match rule.

- [ ] **Step 4: Extract the event-emitting runner**

Move `streamFinalization`, `resolveResearchSnapshot`, source budgeting, and safe
error mapping into `lib/finalization/run-finalization.ts`. Expose:

```ts
export async function runFinalization(options: {
  modelClient: DeepSeekClient;
  anySearchClient: AnySearchClient;
  input: FinalizeRequest;
  signal?: AbortSignal;
  emit: (event: FinalizeStreamEvent) => void | Promise<void>;
}): Promise<void>;
```

Use a fresh non-aborted signal when `signal` is omitted. Emit exactly one terminal
`complete` or `error` event. Keep research source limits unchanged.

- [ ] **Step 5: Delegate the SSE route to the runner**

Keep `/api/finalize` response headers and stream encoding. Replace its inline
pipeline with `runFinalization({ ..., signal: request.signal, emit })`.

- [ ] **Step 6: Verify compatibility**

Run:

```powershell
npm.cmd test -- app/api/finalize/route.test.ts
```

Expected: all existing finalization route tests PASS.

### Task 2: Build the Process-Local Job Registry

**Files:**
- Create: `lib/finalization/finalize-job-store.ts`
- Test: `lib/finalization/finalize-job-store.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover:

```ts
const job = store.create();
expect(store.get(job.id)).toMatchObject({ state: "queued" });

store.apply(job.id, { type: "status", stage: "analyzing" });
expect(store.get(job.id)).toMatchObject({
  state: "running",
  stage: "analyzing",
});

store.apply(job.id, { type: "assessment", result });
store.apply(job.id, { type: "complete" });
expect(store.get(job.id)).toMatchObject({
  state: "completed",
  assessment: result,
});
```

Also test safe failure storage, returned snapshot cloning, missing IDs, and
expiration after 30 minutes using an injected clock.

- [ ] **Step 2: Run and observe RED**

Run:

```powershell
npm.cmd test -- lib/finalization/finalize-job-store.test.ts
```

Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement the minimal registry**

Define `FinalizeJobSnapshot`, `FinalizeJobStore`, and a singleton:

```ts
export class FinalizeJobStore {
  create(): FinalizeJobSnapshot;
  apply(jobId: string, event: FinalizeStreamEvent): void;
  get(jobId: string): FinalizeJobSnapshot | null;
}

export const finalizeJobStore = new FinalizeJobStore();
```

Use `Map<string, FinalizeJobSnapshot>`, `structuredClone`, injected `now`, and
opportunistic terminal-job cleanup. Do not create timers or persistence.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm.cmd test -- lib/finalization/finalize-job-store.test.ts
```

Expected: all registry tests PASS.

### Task 3: Add Create and Poll Routes

**Files:**
- Create: `app/api/finalize-jobs/route.ts`
- Create: `app/api/finalize-jobs/route.test.ts`
- Create: `app/api/finalize-jobs/[jobId]/route.ts`
- Create: `app/api/finalize-jobs/[jobId]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

The POST test must verify:

```ts
const response = await POST(validRequest());
expect(response.status).toBe(202);
expect(await response.json()).toEqual({
  jobId: expect.any(String),
  state: "queued",
});
```

Use a deferred provider response and assert POST resolves before the provider
promise. Add invalid-input `400` and missing-configuration `503` cases.

The GET test must verify a known snapshot returns `200` with
`Cache-Control: no-store`, while an unknown ID returns:

```ts
{
  code: "job_not_found",
  message: "分析任务不存在或已过期，请重新开始最终分析。",
  retryable: true
}
```

- [ ] **Step 2: Run and observe RED**

Run:

```powershell
npm.cmd test -- app/api/finalize-jobs/route.test.ts app/api/finalize-jobs/[jobId]/route.test.ts
```

Expected: FAIL because both route handlers are missing.

- [ ] **Step 3: Implement POST**

Parse with `finalizeRequestSchema`, check configuration, create the registry
entry, and start the runner without awaiting it:

```ts
const job = finalizeJobStore.create();
void runFinalization({
  modelClient: createDeepSeekClientFromEnv(),
  anySearchClient: createAnySearchClientFromEnv(),
  input: parsed.data,
  emit: (event) => finalizeJobStore.apply(job.id, event),
});
return Response.json(
  { jobId: job.id, state: job.state },
  { status: 202, headers: { "Cache-Control": "no-store" } },
);
```

Do not pass `request.signal` into the runner.

- [ ] **Step 4: Implement GET**

Read `context.params.jobId`, return the cloned registry snapshot, and return the
safe 404 body for missing or expired jobs.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm.cmd test -- app/api/finalize-jobs/route.test.ts app/api/finalize-jobs/[jobId]/route.test.ts
```

Expected: all create/poll route tests PASS.

### Task 4: Add a Strict Client Job Parser

**Files:**
- Create: `lib/streaming/finalize-job.ts`
- Create: `lib/streaming/finalize-job.test.ts`

- [ ] **Step 1: Write failing parser tests**

Test valid queued, running, completed, and failed snapshots. Reject a completed
snapshot without an assessment, an invalid stage, and a failed snapshot without
a safe error.

- [ ] **Step 2: Run and observe RED**

Run:

```powershell
npm.cmd test -- lib/streaming/finalize-job.test.ts
```

Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement the parser**

Export:

```ts
export type FinalizeJobSnapshot = /* discriminated union */;
export async function readFinalizeJob(response: Response):
  Promise<FinalizeJobSnapshot>;
```

Parse `response.json()` and validate state-specific required fields without
accepting arbitrary terminal payloads.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm.cmd test -- lib/streaming/finalize-job.test.ts
```

Expected: all parser tests PASS.

### Task 5: Replace SSE Consumption with Polling

**Files:**
- Modify: `lib/workspace/use-assessment-session.ts`
- Modify: `lib/workspace/use-assessment-session.test.tsx`

- [ ] **Step 1: Rewrite one happy-path test to expect JobID polling**

Mock:

```ts
fetcher
  .mockResolvedValueOnce(Response.json(
    { jobId: "job-1", state: "queued" },
    { status: 202 },
  ))
  .mockResolvedValueOnce(Response.json({
    id: "job-1",
    state: "running",
    stage: "researching",
    researchSnapshot,
  }))
  .mockResolvedValueOnce(Response.json({
    id: "job-1",
    state: "completed",
    stage: "scoring",
    researchSnapshot,
    assessment: analysisResult,
  }));
```

Use fake timers to advance two-second polling intervals. Assert the first call is
`/api/finalize-jobs`, later calls are `/api/finalize-jobs/job-1`, research saves
before assessment, and `finalizeCurrent()` resolves `true`.

- [ ] **Step 2: Run and observe RED**

Run:

```powershell
npm.cmd test -- lib/workspace/use-assessment-session.test.tsx
```

Expected: FAIL because the hook still calls `/api/finalize` and reads SSE.

- [ ] **Step 3: Implement Job creation**

POST the unchanged finalization body to `/api/finalize-jobs`. Require HTTP 202
and a non-empty `jobId`; map invalid responses to the existing
`invalid_response` workspace error.

- [ ] **Step 4: Implement two-second polling**

Add an abort-aware `waitForPoll(2_000, signal)` helper. Poll the encoded JobID
path, apply each new stage, research plan, and research snapshot once, and stop
only for `completed`, `failed`, or explicit client abort.

Track whether the research snapshot has already been persisted so repeated
snapshots do not duplicate writes. A failed GET caused by a network exception
waits and retries; a valid non-2xx API error remains terminal.

- [ ] **Step 5: Preserve final assessment saving**

Convert the completed job assessment into the existing `AssessmentRecord`, then
execute the unchanged `FINALIZATION_SAVE_STARTED`, `saveAssessment`,
`SAVE_FAILED`, `SAVE_SUCCEEDED`, and project refresh behavior.

- [ ] **Step 6: Add failure and recovery tests**

Cover:

- one transient GET rejection followed by completion;
- terminal failed job mapping to `retry_finalize`;
- `404 job_not_found` mapping to a new finalization retry;
- abort on component disposal stopping future polling;
- research snapshot saved once across repeated running snapshots.

- [ ] **Step 7: Verify hook behavior**

Run:

```powershell
npm.cmd test -- lib/workspace/use-assessment-session.test.tsx
```

Expected: all hook tests PASS.

### Task 6: Full Verification

**Files:**
- Modify only files required by failures directly caused by this feature.

- [ ] **Step 1: Run focused tests**

```powershell
npm.cmd test -- lib/finalization/finalize-job-store.test.ts app/api/finalize/route.test.ts app/api/finalize-jobs/route.test.ts app/api/finalize-jobs/[jobId]/route.test.ts lib/streaming/finalize-job.test.ts lib/workspace/use-assessment-session.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete suite**

```powershell
npm.cmd test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run static checks**

```powershell
npm.cmd run lint
npm.cmd run build
```

Expected: both commands exit `0`.

- [ ] **Step 4: Verify the running service**

POST invalid JSON to `http://127.0.0.1:3001/api/finalize-jobs` and verify a safe
`400` response. Start one harmless test job only if a disposable project request
is available; otherwise report that live full-project execution was not rerun.

- [ ] **Step 5: Review the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only intended feature files plus the already
approved timeout change are modified.

