import { AdvisorScreen } from "@/components/advisor/advisor-screen";

export default async function AdvisorPage({
  params,
}: PageProps<"/advisor/[projectId]">) {
  const { projectId } = await params;
  return <AdvisorScreen projectId={projectId} />;
}
