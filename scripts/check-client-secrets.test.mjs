import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanClientSecrets } from "./check-client-secrets.mjs";

async function buildTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sabc-secret-scan-"));
  const staticDir = path.join(root, ".next", "static", "chunks");
  const clientManifestDir = path.join(root, ".next", "server", "app");
  await mkdir(staticDir, { recursive: true });
  await mkdir(clientManifestDir, { recursive: true });
  await writeFile(path.join(root, ".next", "BUILD_ID"), "test-build", "utf8");
  await writeFile(path.join(staticDir, "app.js"), "console.log('safe bundle')", "utf8");
  await writeFile(
    path.join(clientManifestDir, "page_client-reference-manifest.js"),
    "self.__RSC_MANIFEST = {}",
    "utf8",
  );
  return { root, staticDir };
}

test("passes a harmless client build", async () => {
  const { root } = await buildTree();
  const result = await scanClientSecrets({
    root,
    env: { TEST_SECRET_MARKER: "marker-that-must-not-print" },
  });

  assert.equal(result.ok, true);
  assert.ok(result.filesScanned >= 2);
});

test("fails a marked bundle without returning or printing the marker", async () => {
  const { root, staticDir } = await buildTree();
  const marker = "marker-that-must-not-print";
  await writeFile(path.join(staticDir, "leak.js"), `window.value = '${marker}'`, "utf8");
  const messages = [];

  const result = await scanClientSecrets({
    root,
    env: { TEST_SECRET_MARKER: marker },
    logger: (message) => messages.push(message),
  });

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(messages.join("\n").includes(marker), false);
});

test("detects a configured AnySearch key without returning the key", async () => {
  const { root, staticDir } = await buildTree();
  const key = "as_sk_anysearch-secret-value";
  await writeFile(path.join(staticDir, "research.js"), `window.key = '${key}'`, "utf8");

  const result = await scanClientSecrets({
    root,
    env: { ANYSEARCH_API_KEY: key },
  });

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test("requires a completed Next.js build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sabc-secret-scan-no-build-"));

  await assert.rejects(
    () => scanClientSecrets({ root, env: {} }),
    /successful Next\.js build/i,
  );
});
