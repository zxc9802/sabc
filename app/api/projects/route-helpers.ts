import { NextRequest, NextResponse } from "next/server";

import { CloudStorageError, createCloudProjectRepository } from "@/lib/storage/cloud-project-repository";
import { getPostgresPool } from "@/lib/storage/postgres";
import { isSsoOwner, requireSsoOwner } from "@/lib/storage/require-sso-owner";

export async function storageContext(request: NextRequest) {
  const owner = await requireSsoOwner(request);
  if (!isSsoOwner(owner)) return owner;
  return {
    ownerId: owner.ownerId,
    repository: createCloudProjectRepository(getPostgresPool()),
  };
}

export function isStorageContext(
  value: Awaited<ReturnType<typeof storageContext>>,
): value is { ownerId: string; repository: ReturnType<typeof createCloudProjectRepository> } {
  return "ownerId" in value;
}

export function badRequest() {
  return NextResponse.json({ error: "请求参数校验失败。" }, { status: 400 });
}

export function notFound() {
  return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
}

export function storageFailure(error: unknown) {
  if (error instanceof CloudStorageError && error.code === "invalid_report_snapshot") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "云端记录保存失败，请重试。" }, { status: 500 });
}
