import type { ProjectRecord } from "@/lib/storage/db";

export function projectDestination(project: ProjectRecord): string {
  const id = encodeURIComponent(project.id);
  if (project.status === "final") return `/report/${id}`;
  if (project.status === "provisional") return `/advisor/${id}`;
  return `/?projectId=${id}`;
}
