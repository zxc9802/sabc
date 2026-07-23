import "server-only";

import { finalizeJobStore } from "@/lib/finalization/finalize-job-store";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { jobId } = await context.params;
  const job = finalizeJobStore.get(jobId);

  if (!job) {
    return Response.json(
      {
        code: "job_not_found",
        message: "分析任务不存在或已过期，请重新开始最终分析。",
        retryable: true,
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(job, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

