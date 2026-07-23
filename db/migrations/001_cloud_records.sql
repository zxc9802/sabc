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

CREATE INDEX sabc_projects_owner_updated_idx
  ON sabc_projects (owner_id, updated_at DESC);

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
  FOREIGN KEY (owner_id, project_id)
    REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX sabc_messages_owner_project_created_idx
  ON sabc_messages (owner_id, project_id, created_at);

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
  FOREIGN KEY (owner_id, project_id)
    REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX sabc_assessments_owner_project_created_idx
  ON sabc_assessments (owner_id, project_id, created_at);

CREATE TABLE sabc_evidence (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, assessment_id)
    REFERENCES sabc_assessments (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX sabc_evidence_owner_assessment_idx
  ON sabc_evidence (owner_id, assessment_id);

CREATE TABLE sabc_research_snapshots (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX sabc_research_owner_project_updated_idx
  ON sabc_research_snapshots (owner_id, project_id, updated_at DESC);

CREATE TABLE sabc_reports (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  assessment_snapshot JSONB NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES sabc_projects (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, assessment_id)
    REFERENCES sabc_assessments (owner_id, id) ON DELETE CASCADE
);

CREATE INDEX sabc_reports_owner_project_created_idx
  ON sabc_reports (owner_id, project_id, created_at DESC);
