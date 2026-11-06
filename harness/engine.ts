import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HEADER, exists, formatLint, formatTests, lintWorkspace, runTests } from "./check.ts";

const STOP_WORDS = new Set([
  "a", "an", "the", "with", "and", "or", "to", "for", "of", "that", "into", "from",
]);

export type GeneratedFile = { path: string; contents: string };

export type Generate = (prompt: string) => Promise<string>;

export type BuildRequest = {
  command: string;
  requirement: string;
  name?: string;
  overwrite?: boolean;
  workspace: string;
  generate: Generate;
  repairs?: number;
};

export type BuildResult = {
  name: string;
  files: string[];
  tests: string;
  lint: string;
  ok: boolean;
};

export function slugFromRequirement(requirement: string): string {
  const words = requirement
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word));
  const slug = words.slice(0, 4).join("-").replace(/-+/g, "-");
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug) ? slug : "module";
}

export function parseGenerated(raw: string): { files: GeneratedFile[] } {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The generator did not return a JSON object.");
  }
  const parsed: unknown = JSON.parse(body.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || !("files" in parsed)) {
    throw new Error("The generator JSON is missing files.");
  }
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("The generator returned no files.");
  }
  return {
    files: files.map((file) => {
      if (!file || typeof file !== "object") throw new Error("A file entry is not an object.");
      const entry = file as { path?: unknown; contents?: unknown };
      if (typeof entry.path !== "string" || typeof entry.contents !== "string") {
        throw new Error("Each file needs a path and contents string.");
      }
      return { path: entry.path, contents: entry.contents };
    }),
  };
}

function expectedPaths(command: string, name: string): string[] {
  if (command === "test") return [`test/${name}.test.js`];
  return [`src/${name}.js`, `test/${name}.test.js`];
}

function safeRelative(filePath: string): string {
  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Refusing to write outside the workspace: ${filePath}`);
  }
  if (!/^src\/[a-z0-9-]+\.js$/.test(normalized) && !/^test\/[a-z0-9-]+\.test\.js$/.test(normalized)) {
    throw new Error(`Refusing unexpected path: ${filePath}`);
  }
  return normalized;
}

function withHeader(contents: string): string {
  const text = contents.replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith(HEADER)) return text.endsWith("\n") ? text : `${text}\n`;
  return `${HEADER}\n${text.endsWith("\n") ? text : `${text}\n`}`;
}

function placeFiles(command: string, name: string, files: GeneratedFile[]): GeneratedFile[] {
  const expected = expectedPaths(command, name);
  const placed = files.map((file) => ({
    path: safeRelative(file.path),
    contents: withHeader(file.contents),
  }));
  const have = new Set(placed.map((file) => file.path));
  for (const target of expected) {
    if (have.has(target)) continue;
    const kind = target.startsWith("src/") ? "src" : "test";
    const donor = placed.find((file) => file.path.startsWith(`${kind}/`) && !expected.includes(file.path));
    if (!donor) throw new Error(`The generator did not return ${target}.`);
    donor.path = target;
    have.add(target);
  }
  const missing = expected.filter((target) => !placed.some((file) => file.path === target));
  if (missing.length > 0) throw new Error(`Missing ${missing.join(", ")}.`);
  return placed.filter((file) => expected.includes(file.path));
}

function promptFor(request: BuildRequest, name: string, feedback?: string): string {
  const paths = expectedPaths(request.command, name);
  const lines = [
    `Command: ${request.command}`,
    `Module name: ${name}`,
    `Requirement: ${request.requirement}`,
    "",
    "Write working JavaScript for that requirement.",
    "Use ESM, node:test, and node:assert/strict.",
    `Every file must start with exactly: ${HEADER}`,
    "No TODO comments, no console.log, no var, no \"not implemented\" stubs.",
    "Keep every line at or under 100 characters.",
    `Return only these files: ${paths.join(", ")}`,
    "Reply with one JSON object and no markdown:",
    '{"files":[{"path":"src/name.js","contents":"..."},{"path":"test/name.test.js","contents":"..."}]}',
  ];
  if (feedback) {
    lines.push("", "The previous attempt failed. Return a full replacement.", feedback);
  }
  return lines.join("\n");
}

export async function build(request: BuildRequest): Promise<BuildResult> {
  const command = request.command.trim().toLowerCase();
  const requirement = request.requirement.trim();
  if (!command || !requirement) {
    throw new Error("Pass a command and a requirement.");
  }
  const name = request.name ?? slugFromRequirement(requirement);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Module name must be kebab-case: ${name}`);
  }
  const targets = expectedPaths(command, name).map((file) => path.join(request.workspace, file));
  if (!request.overwrite) {
    for (const target of targets) {
      if (await exists(target)) {
        throw new Error(
          `${path.relative(request.workspace, target)} already exists. Pass overwrite to replace it.`,
        );
      }
    }
  }

  const repairs = request.repairs ?? 2;
  let feedback: string | undefined;
  let written: string[] = [];
  let tests = "FAIL: not run";
  let lint = "Lint not run.";
  let ok = false;

  for (let attempt = 0; attempt <= repairs; attempt += 1) {
    let placed;
    try {
      const raw = await request.generate(promptFor({ ...request, command, requirement }, name, feedback));
      placed = placeFiles(command, name, parseGenerated(raw).files);
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
      if (attempt === repairs) throw error;
      continue;
    }
    written = [];
    for (const file of placed) {
      const absolute = path.join(request.workspace, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file.contents, "utf8");
      written.push(file.path);
    }
    const testReport = await runTests(request.workspace, name);
    tests = formatTests(testReport);
    const lintReport =
      command === "test"
        ? { issues: [], fileCount: 0 }
        : await lintWorkspace(request.workspace, `${name}.js`);
    lint =
      command === "test"
        ? "Lint skipped for a test-only command."
        : formatLint(lintReport.issues, lintReport.fileCount);
    ok = testReport.status === "PASS" && lintReport.issues.length === 0;
    if (ok) break;
    feedback = `${tests}\n\n${lint}`;
  }

  return { name, files: written, tests, lint, ok };
}
