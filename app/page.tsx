import { ProjectWorkspace } from "@/components/workspace/project-workspace";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { projectId } = await searchParams;
  return (
    <ProjectWorkspace
      initialProjectId={typeof projectId === "string" ? projectId : undefined}
    />
  );
}
