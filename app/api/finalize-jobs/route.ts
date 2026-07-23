import "server-only";

import { POST as startFinalizationStream } from "@/app/api/finalize/route";
import { finalizeJobStore } from "@/lib/finalization/finalize-job-store";
import { readFinalizeStream } from "@/lib/streaming/finalize-stream";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const streamResponse = await startFinalizationStream(
    new Request("http://localhost/api/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );

  if (!streamResponse.ok) return streamResponse;

  const job = finalizeJobStore.create();
  void consumeFinalization(job.id, streamResponse);

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

async function consumeFinalization(
  jobId: string,
  response: Response,
): Promise<void> {
  try {
    await readFinalizeStream(response, (event) => {
      finalizeJobStore.apply(jobId, event);
    });
  } catch {
    finalizeJobStore.apply(jobId, {
      type: "error",
      stage: "analyzing",
      code: "invalid_response",
      message: "最终分析服务返回了无法读取的结果，请重新分析。",
      retryable: true,
    });
  }
}

