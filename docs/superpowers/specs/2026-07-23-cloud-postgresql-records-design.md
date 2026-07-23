# SABC cloud PostgreSQL records design

## Goal

Store all SABC records created after this rollout in SABC's own cloud PostgreSQL database. Every record belongs to exactly one main-site SSO user, identified by the verified main-site `user.id`.

## Scope

- Persist SABC projects, interview/advisory messages, assessments, evidence, research snapshots, and final reports in cloud PostgreSQL.
- Allow every main-site user who has already passed SSO access checks to create and manage only their own SABC records.
- Keep the existing project workspace behavior, report generation, and assessment payload shapes.
- Do not migrate, delete, upload, or display existing browser Dexie records after this rollout.

## Non-goals

- Do not connect to, migrate, or modify the main site's PostgreSQL database.
- Do not introduce a shared data service between SABC and the other target apps.
- Do not accept an owner ID, role override, or tenant ID from browser input.

## Database topology and configuration

SABC receives a dedicated cloud PostgreSQL database and its own `DATABASE_URL`. The URL is server-only and must never be exposed through a `NEXT_PUBLIC_` variable. Schema changes are versioned as SQL migrations and applied explicitly during deployment before the new application version serves traffic.

## Tenant identity and authorization

Every SABC storage route reads the existing encrypted target SSO cookie, validates its main-site token against the main-site session endpoint, and derives `owner_id` from the returned/verified SSO user ID. The route never reads `owner_id` from request JSON, route parameters, or query strings.

All SQL selection, insertion, update, and deletion operations use the derived `owner_id`. A requested project that exists for another user is indistinguishable from a missing project and returns `404`.

## Schema

All tables retain the existing application string IDs as `TEXT` columns, use `owner_id TEXT NOT NULL`, and include timestamp columns. Project-owned child tables include `owner_id` and reference the matching `(owner_id, project_id)` pair, preventing a child record from crossing tenant boundaries.

| Table | Primary content | Important constraints/indexes |
| --- | --- | --- |
| `sabc_projects` | project name, description, category, status, interview depth, timestamps | primary key `id`; unique `(owner_id, id)`; index `(owner_id, updated_at DESC)` |
| `sabc_messages` | project messages, role, round, stage, kind, creation time | foreign key `(owner_id, project_id)`; index `(owner_id, project_id, created_at)` |
| `sabc_assessments` | sources, analysis, scored result, next question, diff as JSONB | foreign key `(owner_id, project_id)`; index `(owner_id, project_id, created_at)` |
| `sabc_evidence` | assessment/dimension metadata and evidence payload | foreign key `(owner_id, project_id)`; index `(owner_id, assessment_id)` |
| `sabc_research_snapshots` | project research snapshot JSONB and update time | foreign key `(owner_id, project_id)`; index `(owner_id, project_id, updated_at DESC)` |
| `sabc_reports` | assessment snapshot JSONB, report content JSONB, creation time | foreign key `(owner_id, project_id)`; index `(owner_id, project_id, created_at DESC)` |

JSONB is used only for existing nested domain values whose current client types already treat them as atomic records. Project relationships, ownership, ordering, and filtering remain relational columns.

## Application flow

1. The browser calls SABC's same-origin storage API without a tenant identifier.
2. The route validates the SSO session and obtains the main-site user ID.
3. The route invokes the PostgreSQL repository with that user ID as `owner_id`.
4. The repository executes owner-scoped SQL and returns only allowed records.
5. The client project repository keeps its existing interface but delegates to the API instead of Dexie.

Project finalization writes the final assessment, evidence rows, current report replacement, and project status update in one PostgreSQL transaction. Any error rolls back the entire operation.

## API behavior

Server routes cover project creation/listing/deletion, workspace retrieval, interview-depth update, message append, research snapshot save, assessment save, and final report/finalization save. Payloads are validated before database access and route-level ownership is enforced before every operation.

- Missing, malformed, expired, or revoked SSO session: `401`, clear the target session, then restart main-site SSO.
- Existing record owned by another user: `404`.
- Invalid payload: `400`.
- Database failure: a safe `500` response without database credentials or raw SQL.

## Local data behavior

On first cloud-enabled load, the user sees an empty cloud project list unless they create new records. The previous Dexie database is left untouched in the browser but is not read, uploaded, altered, or shown by the cloud repository.

## Verification

- Repository and route tests verify that the same SSO owner can create and retrieve records.
- Isolation tests create records for two owners and verify list/get/update/delete never cross the owner boundary.
- Finalization failure tests verify no partial assessment/report writes survive a failed transaction.
- Unauthenticated and revoked-session route tests return `401` and do not execute data operations.
- Existing SABC unit tests, lint, and production build remain green.

## Acceptance criteria

1. A newly created SABC project is available after browser restart or another device login using the same main-site account.
2. A different main-site account cannot discover, read, edit, compare, or delete that project by ID.
3. Existing pre-rollout local records are neither migrated nor removed.
4. SABC remains independently deployable with only its own `DATABASE_URL` and the existing SSO configuration.
