import { NextRequest, NextResponse } from "next/server";

import { finalizationSchema } from "@/lib/storage/storage-schemas";

import { badRequest, isStorageContext, notFound, storageContext, storageFailure } from "../../route-helpers";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const parsed = finalizationSchema.safeParse(await request.json());
    const { projectId } = await params;
    if (
      !parsed.success
      || parsed.data.assessment.projectId !== projectId
      || parsed.data.report.projectId !== projectId
    ) {
      return badRequest();
    }
    return await context.repository.saveFinalization(
      context.ownerId,
      parsed.data.assessment,
      parsed.data.report,
    )
      ? NextResponse.json({ success: true })
      : notFound();
  } catch (error) {
    return storageFailure(error);
  }
}
