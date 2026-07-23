# SABC Cloud PostgreSQL Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every SABC record created after rollout in SABC's dedicated PostgreSQL database, with every query constrained to the verified main-site SSO user.

**Architecture:** Keep the existing `ProjectRepository` interface used by the React screens, but replace its Dexie implementation with a same-origin API client. Next route handlers authenticate the encrypted target SSO session again, derive `owner_id` from `session.user.id`, and call a server-only PostgreSQL repository. The legacy Dexie source and database remain untouched but receive no reads or writes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, `pg`, PostgreSQL SQL migrations, Vitest.

---

## File structure

- Create: `db/migrations/001_cloud_records.sql` — owner-scoped SABC tables and indexes.
- Create: `lib/storage/postgres.ts` — server-only singleton `pg` pool.
- Create: `lib/storage/require-sso-owner.ts` — verified SSO owner lookup and JSON `401` response.
- Create: `lib/storage/cloud-project-repository.ts` — transaction-aware, owner-scoped SQL implementation.
- Create: `lib/storage/storage-schemas.ts` — Zod request schemas shared by storage routes.
- Create: `app/api/projects/route.ts` — create/list projects.
- Create: `app/api/projects/final-assessments/route.ts` — compare-page assessment lookup.
- Create: `app/api/projects/[projectId]/route.ts` — get workspace, update interview depth, delete project.
- Create: `app/api/projects/[projectId]/messages/route.ts` — append interview/advisory message.
- Create: `app/api/projects/[projectId]/research-snapshot/route.ts` — upsert research snapshot.
- Create: `app/api/projects/[projectId]/assessments/route.ts` — save provisional assessment and evidence.
- Create: `app/api/projects/[projectId]/reports/route.ts` — save report snapshot.
- Create: `app/api/projects/[projectId]/finalization/route.ts` — atomic final assessment/report save.
- Modify: `lib/storage/project-repository.ts` — same public interface, browser `fetch` adapter only.
- Modify: `proxy.ts` — return JSON `401` instead of an HTML redirect for invalid API requests.
- Modify: `package.json`, `package-lock.json`, `.env.example` — `pg`, typings, and server-only `DATABASE_URL` contract.
- Modify: `lib/storage/project-repository.test.ts` — test API adapter behavior instead of Dexie.
- Create: `lib/storage/cloud-project-repository.test.ts` and `lib/storage/require-sso-owner.test.ts` — repository isolation and auth tests.

### Task 1: Add the database contract and connection boundary

**Files:**
- Create: `db/migrations/001_cloud_records.sql`
- Create: `lib/storage/postgres.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

- [ ] **Step 1: Write the migration assertions before implementation**

Create `lib/storage/cloud-project-repository.test.ts` with a recording `SqlPool`. Its first tests must assert that every generated select starts with `owner_id = $1`, and that finalization starts a transaction and rolls back when a query throws:

```ts
it("scopes workspace queries to the verified owner", async () => {
  const sql = recordingSql();
  await createCloudProjectRepository(sql).getProjectWorkspace("user-a", "project-1");
  expect(sql.calls[0]).toMatchObject({
    text: expect.stringContaining("WHERE owner_id = $1 AND id = $2"),
    values: ["user-a", "project-1"],
  });
});

it("rolls back a failed finalization", async () => {
  const sql = recordingSql({ failAt: 4 });
  await expect(createCloudProjectRepository(sql).saveFinalization("user-a", assessment, report))
    .rejects.toThrow("storage_failed");
  expect(sql.commands).toEqual(["BEGIN", "ROLLBACK"]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- lib/storage/cloud-project-repository.test.ts`

Expected: FAIL because `cloud-project-repository.ts` does not exist.

- [ ] **Step 3: Add PostgreSQL packages and server configuration**

Run `npm install pg` and `npm install -D @types/pg`. Add exactly this comment and key to `.env.example`; do not add it to a `NEXT_PUBLIC_` variable:

```dotenv
# Dedicated SABC cloud PostgreSQL database; never expose this value to the browser.
DATABASE_URL=
```

Create `lib/storage/postgres.ts`:

```ts
import "server-only";

import { Pool } from "pg";

declare global {
  var sabcPostgresPool: Pool | undefined;
}

export function getPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  globalThis.sabcPostgresPool ??= new Pool({ connectionString });
  return globalThis.sabcPostgresPool;
}
```

- [ ] **Step 4: Create the versioned migration**

Create `db/migrations/001_cloud_records.sql` using text IDs to preserve the existing application contract. The migration must include these owner-first keys and foreign keys:

```sql
CREATE TABLE sabc_projects (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  primary_category TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'provisional', 'final')),
  interview_depth TEXT NOT NULL CHECK (interview_depth IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX sabc_projects_owner_updated_idx ON sabc_projects (owner_id, updated_at DESC);

CREATE TABLE sabc_messages (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round >= 0),
  stage TEXT CHECK (stage IN ('interview', 'advisory')),
  kind TEXT CHECK (kind IN ('chat', 'advisor_summary')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX sabc_messages_owner_project_created_idx ON sabc_messages (owner_id, project_id, created_at);

CREATE TABLE sabc_assessments (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  sources JSONB NOT NULL,
  research_status TEXT NOT NULL,
  analysis JSONB NOT NULL,
  scored JSONB NOT NULL,
  next_question JSONB,
  diff JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX sabc_assessments_owner_project_created_idx ON sabc_assessments (owner_id, project_id, created_at);

CREATE TABLE sabc_evidence (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, assessment_id) REFERENCES sabc_assessments (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX sabc_evidence_owner_assessment_idx ON sabc_evidence (owner_id, assessment_id);

CREATE TABLE sabc_research_snapshots (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX sabc_research_owner_project_updated_idx ON sabc_research_snapshots (owner_id, project_id, updated_at DESC);

CREATE TABLE sabc_reports (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  assessment_snapshot JSONB NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, assessment_id) REFERENCES sabc_assessments (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX sabc_reports_owner_project_created_idx ON sabc_reports (owner_id, project_id, created_at DESC);
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- lib/storage/cloud-project-repository.test.ts`

Expected: still FAIL only because the SQL repository has not yet been implemented; the migration file and package type checks succeed after Task 2.

Commit:

```bash
git add package.json package-lock.json .env.example db/migrations/001_cloud_records.sql lib/storage/postgres.ts lib/storage/cloud-project-repository.test.ts
git commit -m "feat: add SABC cloud PostgreSQL schema"
```

### Task 2: Derive the storage owner from the verified SSO session

**Files:**
- Create: `lib/storage/require-sso-owner.ts`
- Create: `lib/storage/require-sso-owner.test.ts`
- Modify: `proxy.ts`

- [ ] **Step 1: Write failing auth tests**

Mock `readMainAppSessionCookie` and `validateMainAppSession`. Test that a valid session returns only `session.user.id`, and an invalid or revoked session returns a JSON `401`, clears `qycm_sabc_sso`, and never calls the repository.

```ts
expect(await requireSsoOwner(requestWith("valid-cookie"))).toEqual({ ownerId: "user-a" });
const result = await requireSsoOwner(requestWith("revoked-cookie"));
expect(result.status).toBe(401);
expect(result.cookies.get(getMainAppSessionCookieName())?.value).toBe("");
```

- [ ] **Step 2: Run the auth test to verify it fails**

Run: `npm test -- lib/storage/require-sso-owner.test.ts`

Expected: FAIL because the owner guard does not exist.

- [ ] **Step 3: Implement the owner guard and API-aware proxy response**

Create `lib/storage/require-sso-owner.ts` with this shape:

```ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  readMainAppSessionCookie,
  validateMainAppSession,
} from "@/lib/main-app-sso";

export type SsoOwnerResult = { ownerId: string } | NextResponse;

export async function requireSsoOwner(request: NextRequest): Promise<SsoOwnerResult> {
  const session = await readMainAppSessionCookie(request.cookies.get(getMainAppSessionCookieName())?.value);
  if (session && await validateMainAppSession(session)) return { ownerId: session.user.id };
  const response = NextResponse.json({ error: "Main-site session is invalid." }, { status: 401 });
  response.cookies.set(getMainAppSessionCookieName(), "", { ...getMainAppSessionCookieOptions(), maxAge: 0 });
  return response;
}

export function isSsoOwner(result: SsoOwnerResult): result is { ownerId: string } {
  return "ownerId" in result;
}
```

In `proxy.ts`, keep browser navigation redirects, but return the same JSON `401` and expired-cookie deletion when `request.nextUrl.pathname.startsWith('/api/')`. This preserves fetch semantics for all protected APIs while route handlers still independently derive the owner.

- [ ] **Step 4: Run auth and existing SSO tests**

Run: `npm test -- lib/storage/require-sso-owner.test.ts lib/main-app-sso.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/require-sso-owner.ts lib/storage/require-sso-owner.test.ts proxy.ts
git commit -m "feat: derive SABC storage owner from SSO"
```

### Task 3: Implement the owner-scoped PostgreSQL repository

**Files:**
- Create: `lib/storage/cloud-project-repository.ts`
- Modify: `lib/storage/cloud-project-repository.test.ts`

- [ ] **Step 1: Implement a testable SQL boundary**

Expose injected interfaces so tests do not need a cloud database:

```ts
export type SqlClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release?(): void;
};

export type SqlPool = SqlClient & {
  connect(): Promise<SqlClient>;
};

export function createCloudProjectRepository(pool: SqlPool) {
  return {
    createProject(ownerId: string, description: string): Promise<ProjectRecord>,
    updateInterviewDepth(ownerId: string, projectId: string, depth: InterviewDepth): Promise<ProjectRecord>,
    appendMessage(ownerId: string, message: MessageRecord): Promise<void>,
    saveResearchSnapshot(ownerId: string, input: ResearchSnapshotRecord): Promise<void>,
    saveAssessment(ownerId: string, input: AssessmentRecord): Promise<void>,
    saveFinalReport(ownerId: string, input: FinalReportRecord): Promise<void>,
    saveFinalization(ownerId: string, assessment: AssessmentRecord, report: FinalReportRecord): Promise<void>,
    getProjectWorkspace(ownerId: string, projectId: string): Promise<ProjectWorkspaceRecord | null>,
    listProjects(ownerId: string): Promise<ProjectRecord[]>,
    listFinalAssessments(ownerId: string, projectIds: string[]): Promise<FinalAssessmentRecord[]>,
    deleteProject(ownerId: string, projectId: string): Promise<boolean>,
  };
}
```

Use parameterized values exclusively. `getProjectWorkspace`, update, and delete must query the project with `WHERE owner_id = $1 AND id = $2`; return `null`/`false` for a missing or other-owner ID. Insert the evidence derived from `assessment.analysis.dimensions` with a generated UUID and JSONB payload. Transform PostgreSQL `snake_case` rows and JSONB values back into the existing camel-case record types and ISO date strings.

- [ ] **Step 2: Preserve finalization atomicity**

For finalization, call `pool.connect()` inside the repository, execute `BEGIN`, insert the assessment and evidence, delete prior reports with `WHERE owner_id = $1 AND project_id = $2`, insert the report, update the matching project to `final`, then `COMMIT`. On any error execute `ROLLBACK` before rethrowing, and release the client in `finally`.

```ts
await client.query("BEGIN");
try {
  await saveAssessmentRows(client, ownerId, assessment);
  await client.query("DELETE FROM sabc_reports WHERE owner_id = $1 AND project_id = $2", [ownerId, assessment.projectId]);
  await insertReport(client, ownerId, report);
  await client.query("UPDATE sabc_projects SET status = 'final', name = $3, primary_category = $4, updated_at = $5 WHERE owner_id = $1 AND id = $2", [ownerId, assessment.projectId, assessment.analysis.projectName, assessment.analysis.primaryCategory, report.createdAt]);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw storageFailure(error);
}
```

- [ ] **Step 3: Complete repository tests**

Add tests for user A/user B predicate values, `404`-compatible missing results, evidence insertion, ordered messages, latest research/report selection, and the transaction rollback from Task 1. Keep test fixtures aligned with `ProjectRecord`, `AssessmentRecord`, and `FinalReportRecord` from `lib/storage/db.ts`.

- [ ] **Step 4: Run focused repository tests**

Run: `npm test -- lib/storage/cloud-project-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/cloud-project-repository.ts lib/storage/cloud-project-repository.test.ts
git commit -m "feat: add owner-scoped SABC record repository"
```

### Task 4: Expose validated, protected storage APIs

**Files:**
- Create: `lib/storage/storage-schemas.ts`
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/final-assessments/route.ts`
- Create: `app/api/projects/[projectId]/route.ts`
- Create: `app/api/projects/[projectId]/messages/route.ts`
- Create: `app/api/projects/[projectId]/research-snapshot/route.ts`
- Create: `app/api/projects/[projectId]/assessments/route.ts`
- Create: `app/api/projects/[projectId]/reports/route.ts`
- Create: `app/api/projects/[projectId]/finalization/route.ts`
- Create: `app/api/projects/projects-api.test.ts`

- [ ] **Step 1: Define complete request schemas**

In `storage-schemas.ts`, construct Zod schemas from the existing domain structures: `descriptionSchema`, `interviewDepthSchema`, `messageSchema`, `researchSnapshotSchema`, `assessmentSchema`, `reportSchema`, and `finalizationSchema`. Every schema includes `projectId` and is refined so route `params.projectId` equals body `projectId`; no schema has `ownerId`.

```ts
export const messageSchema = z.strictObject({
  id: z.string().min(1), projectId: z.string().min(1),
  role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000),
  round: z.number().int().min(0),
  createdAt: z.string().datetime(),
  stage: z.enum(["interview", "advisory"]).optional(),
  kind: z.enum(["chat", "advisor_summary"]).optional(),
});
```

- [ ] **Step 2: Write failing API tests**

Mock `requireSsoOwner` and the cloud repository. Test: valid user A list/create works; an owner-mismatched project returns `404`; malformed body returns `400`; a rejected SSO session returns the guard's `401` before repository invocation.

```ts
expect(await POST(projectRequest({ description: "new" }))).toHaveProperty("status", 201);
expect(await DELETE(projectRequest({}, { projectId: "user-b-project" }))).toHaveProperty("status", 404);
expect(repository.deleteProject).not.toHaveBeenCalled();
```

- [ ] **Step 3: Implement route handlers**

Each handler starts with `const owner = await requireSsoOwner(request); if (!isSsoOwner(owner)) return owner;`. Parse JSON with `safeParse`; respond `{ error: "请求参数校验失败。" }` with `400` on failure. Instantiate the server repository from `getPostgresPool()` only after SSO success. Map missing owner-scoped records to `404`, database exceptions to `{ error: "云端记录保存失败，请重试。" }` with `500`, and return only existing record shapes.

Routes and operations are fixed as follows:

```text
GET/POST    /api/projects
POST        /api/projects/final-assessments
GET/PATCH/DELETE /api/projects/[projectId]
POST        /api/projects/[projectId]/messages
POST        /api/projects/[projectId]/research-snapshot
POST        /api/projects/[projectId]/assessments
POST        /api/projects/[projectId]/reports
POST        /api/projects/[projectId]/finalization
```

- [ ] **Step 4: Run API tests**

Run: `npm test -- app/api/projects/projects-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/storage-schemas.ts app/api/projects
git commit -m "feat: add protected SABC record APIs"
```

### Task 5: Replace the browser Dexie repository with the API adapter

**Files:**
- Modify: `lib/storage/project-repository.ts`
- Modify: `lib/storage/project-repository.test.ts`

- [ ] **Step 1: Write adapter tests that fail without cloud routes**

Mock `global.fetch` and assert `createProjectRepository()` sends no owner field, uses credentials on same-origin requests, maps a `404` workspace to `null`, and raises the server message on non-success responses.

```ts
expect(fetch).toHaveBeenCalledWith("/api/projects/project-1", expect.objectContaining({ credentials: "same-origin" }));
expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).not.toHaveProperty("ownerId");
```

- [ ] **Step 2: Implement the fetch adapter**

Keep the exported `ProjectRepository` interface and `createProjectRepository()` name unchanged. Replace all runtime Dexie imports and local mutation logic with a private `requestJson<T>` helper:

```ts
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new StorageError("storage_failed", payload.error || "云端记录保存失败，请重试。");
  return payload as T;
}
```

Send only existing record payloads. `createProject` sends `{ description }`; every other project mutation uses the fixed paths in Task 4. `db.ts` may be imported only with `import type` for the existing shared record types; do not import a Dexie value or use `indexedDB` in this file.

- [ ] **Step 3: Run adapter and screen tests**

Run: `npm test -- lib/storage/project-repository.test.ts components/workspace/project-workspace.test.tsx components/advisor/advisor-screen.test.tsx components/report/report-screen.test.tsx components/research/research-handoff-screen.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/storage/project-repository.ts lib/storage/project-repository.test.ts
git commit -m "feat: store SABC records through cloud APIs"
```

### Task 6: Verify the completed SABC boundary

**Files:**
- Modify only if required by test results from prior tasks.

- [ ] **Step 1: Scan the active repository path for legacy writes**

Run: `rg -n "createProjectRepository\(|db\.(projects|messages|assessments|evidence|reports|researchSnapshots)|indexedDB" lib components app --glob '*.{ts,tsx}'`

Expected: only `db.ts` type/legacy definitions and test fixtures remain; no active browser repository write calls remain.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests, lint, and production build PASS.

- [ ] **Step 3: Verify two-account isolation against the deployed database**

After `DATABASE_URL` is configured and migration `001_cloud_records.sql` is applied, create one project as account A. Log in as account B and request A's project path through the application API; expect `404`. Log in again as A on a second browser/device; expect the new project to appear. Confirm no pre-rollout Dexie project is shown.

- [ ] **Step 4: Record the verification outcome**

If a verification check changed no source file, do not create an empty commit. If a check exposed a defect, fix it in the owning task file, rerun that task's focused test and all commands from Step 2, then commit with `git commit -m "test: verify SABC cloud record isolation"` after staging only the reviewed fix files.

## Self-review

- Dedicated database, server-only `DATABASE_URL`, explicit SQL migration: Tasks 1 and 6.
- SSO-derived owner only, owner predicates, cross-owner `404`, session `401`: Tasks 2 through 4.
- All SABC record kinds, finalization transaction, unchanged client interface: Tasks 3 through 5.
- No Dexie migration, deletion, upload, or display: Tasks 5 and 6.
- Unit, API, UI, build, and two-account acceptance verification: Tasks 1 through 6.
