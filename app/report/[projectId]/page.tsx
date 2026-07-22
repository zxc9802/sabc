import { ReportScreen } from "@/components/report/report-screen";

export default async function ReportPage({
  params,
}: PageProps<"/report/[projectId]">) {
  const { projectId } = await params;
  return <ReportScreen projectId={projectId} />;
}
