import { NextRequest, NextResponse } from "next/server";

import { createProjectSchema } from "@/lib/storage/storage-schemas";

import { badRequest, isStorageContext, storageContext, storageFailure } from "./route-helpers";

export async function GET(request: NextRequest) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    return NextResponse.json({ projects: await context.repository.listProjects(context.ownerId) });
  } catch (error) {
    return storageFailure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await storageContext(request);
    if (!isStorageContext(context)) return context;
    const parsed = createProjectSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest();
    const project = await context.repository.createProject(context.ownerId, parsed.data.description);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return storageFailure(error);
  }
}
