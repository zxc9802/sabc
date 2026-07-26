import "server-only";

import { POST as startReportStream } from "@/app/api/report/route";
import { reportJobStore } from "@/lib/report/final-report-job-store";
import { readFinalReportStream } from "@/lib/report/final-report-stream";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const streamResponse = await startReportStream(
    new Request("http://localhost/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );

  if (!streamResponse.ok) return streamResponse;

  const job = reportJobStore.create();
  void consumeReport(job.id, streamResponse);

  return Response.json(
    { jobId: job.id, state: job.state },
    {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function consumeReport(jobId: string, response: Response): Promise<void> {
  try {
    await readFinalReportStream(response, (event) => {
      reportJobStore.apply(jobId, event);
    });
  } catch {
    reportJobStore.apply(jobId, {
      type: "error",
      stage: "analyzing",
      code: "invalid_response",
      message: "最终报告服务返回了无法读取的结果，请重新生成。",
      retryable: true,
    });
  }
}
