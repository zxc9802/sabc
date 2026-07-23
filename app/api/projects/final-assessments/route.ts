import { NextRequest, NextResponse } from "next/server";

import { projectIdsSchema } from "@/lib/storage/storage-schemas";

import { badRequest, isStorageContext, storageContext, storageFailure } from "../route-helpers";

export async function POST(request: NextRequest) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const parsed = projectIdsSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest();
    const records = await context.repository.listFinalAssessments(context.ownerId, parsed.data.projectIds);
    return NextResponse.json({ records });
  } catch (error) {
    return storageFailure(error);
  }
}
