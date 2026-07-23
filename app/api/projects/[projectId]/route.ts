import { NextRequest, NextResponse } from "next/server";

import { interviewDepthSchema } from "@/lib/storage/storage-schemas";

import { badRequest, isStorageContext, notFound, storageContext, storageFailure } from "../route-helpers";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const { projectId } = await params;
    const workspace = await context.repository.getProjectWorkspace(context.ownerId, projectId);
    return workspace ? NextResponse.json({ workspace }) : notFound();
  } catch (error) {
    return storageFailure(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const parsed = interviewDepthSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest();
    const { projectId } = await params;
    const project = await context.repository.updateInterviewDepth(context.ownerId, projectId, parsed.data.depth);
    return project ? NextResponse.json({ project }) : notFound();
  } catch (error) {
    return storageFailure(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const { projectId } = await params;
    return await context.repository.deleteProject(context.ownerId, projectId)
      ? NextResponse.json({ success: true })
      : notFound();
  } catch (error) {
    return storageFailure(error);
  }
}
