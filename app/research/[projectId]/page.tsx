import { ResearchHandoffScreen } from "@/components/research/research-handoff-screen";

export default async function ResearchPage({
  params,
}: PageProps<"/research/[projectId]">) {
  const { projectId } = await params;
  return <ResearchHandoffScreen projectId={projectId} />;
}
