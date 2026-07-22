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
