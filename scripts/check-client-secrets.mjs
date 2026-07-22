import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_FILE = /\.(?:js|json|map|html|txt)$/i;
const CLIENT_SERVER_FILE = /(?:client|manifest|\.html$)/i;

export async function scanClientSecrets({
  root = process.cwd(),
  env = process.env,
  logger = () => undefined,
} = {}) {
  const nextRoot = path.join(root, ".next");
  try {
    await access(path.join(nextRoot, "BUILD_ID"));
  } catch {
    throw new Error("A successful Next.js build is required before client-secret scanning.");
  }

  const staticFiles = await walkTextFiles(path.join(nextRoot, "static"));
  const serverAppFiles = (await walkTextFiles(path.join(nextRoot, "server", "app"))).filter(
    (file) => CLIENT_SERVER_FILE.test(path.basename(file)),
  );
  const files = [...staticFiles, ...serverAppFiles];
  const exactKeys = [
    nonEmpty(env.DEEPSEEK_API_KEY),
    nonEmpty(env.ANYSEARCH_API_KEY),
  ].filter(Boolean);
  const testMarker = nonEmpty(env.TEST_SECRET_MARKER);
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relativeFile = path.relative(root, file);

    if (exactKeys.some((key) => content.includes(key))) {
      findings.push({ file: relativeFile, rule: "configured-key" });
      continue;
    }
    if (exactKeys.some((key) => content.includes(`Bearer ${key}`))) {
      findings.push({ file: relativeFile, rule: "authorization-header" });
      continue;
    }
    if (exactKeys.length === 0 && testMarker && content.includes(testMarker)) {
      findings.push({ file: relativeFile, rule: "test-marker" });
      continue;
    }
    if (exactKeys.length === 0 && containsHardcodedAssignment(content)) {
      findings.push({ file: relativeFile, rule: "hardcoded-assignment" });
    }
  }

  const result = {
    ok: findings.length === 0,
    filesScanned: files.length,
    findings,
  };
  logger(
    result.ok
      ? `Client-secret scan passed (${files.length} files).`
      : `Client-secret scan failed (${findings.length} finding(s)).`,
  );
  return result;
}

async function walkTextFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkTextFiles(target)));
    } else if (entry.isFile() && TEXT_FILE.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

function containsHardcodedAssignment(content) {
  const assignment =
    /(?:DEEPSEEK_API_KEY|ANYSEARCH_API_KEY)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/g;
  for (const match of content.matchAll(assignment)) {
    const value = match[1].trim().toLowerCase();
    const placeholder =
      value.startsWith("replace-") ||
      value.startsWith("your-") ||
      value.includes("placeholder") ||
      value.includes("process.env") ||
      value.includes("example");
    if (!placeholder) return true;
  }
  return false;
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const isCli = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isCli) {
  try {
    const result = await scanClientSecrets({ logger: console.log });
    if (!result.ok) {
      console.error("Potential client-side secret exposure detected. Values are intentionally redacted.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Client-secret scan failed.");
    process.exitCode = 1;
  }
}
