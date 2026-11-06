// fake-harness: a local MCP harness. `build` generates working code from a
// command plus a requirement. Everything it touches lives in ./workspace.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { HEADER, exists, formatLint, formatTests, lintWorkspace, runTests } from "./check.ts";
import { build } from "./engine.ts";
import { generateLocally } from "./local.ts";

const projectRoot =
  process.env.CLAUDE_PROJECT_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspace =
  process.env.HARNESS_WORKSPACE ?? path.join(projectRoot, "workspace");
const srcDir = path.join(workspace, "src");
const testDir = path.join(workspace, "test");

function text(message: string, isError = false) {
  return { content: [{ type: "text" as const, text: message }], isError };
}

// kebab-case file name -> camelCase / PascalCase identifiers
function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
function pascal(name: string): string {
  const c = camel(name);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

type Template = {
  description: string;
  files: (name: string) => { dir: string; file: string; body: string }[];
};

const testFile = (name: string, importLine: string, check: string) => ({
  dir: testDir,
  file: `${name}.test.js`,
  body: `${HEADER} (template: test)
import { test } from "node:test";
import assert from "node:assert/strict";
${importLine}

test("${name}: replace this placeholder with real tests", () => {
  ${check}
});
`,
});

const templates: Record<string, Template> = {
  function: {
    description: "A single exported function plus a test file.",
    files: (name) => [
      {
        dir: srcDir,
        file: `${name}.js`,
        body: `${HEADER} (template: function)

/**
 * TODO: describe what ${camel(name)} does.
 */
export function ${camel(name)}(...args) {
  throw new Error("${camel(name)}: not implemented");
}
`,
      },
      testFile(
        name,
        `import { ${camel(name)} } from "../src/${name}.js";`,
        `assert.equal(typeof ${camel(name)}, "function");`,
      ),
    ],
  },
  class: {
    description: "An exported class with a constructor plus a test file.",
    files: (name) => [
      {
        dir: srcDir,
        file: `${name}.js`,
        body: `${HEADER} (template: class)

/**
 * TODO: describe ${pascal(name)}.
 */
export class ${pascal(name)} {
  constructor(options = {}) {
    this.options = options;
  }
}
`,
      },
      testFile(
        name,
        `import { ${pascal(name)} } from "../src/${name}.js";`,
        `assert.ok(new ${pascal(name)}() instanceof ${pascal(name)});`,
      ),
    ],
  },
  endpoint: {
    description:
      "A REST-style request handler (node:http compatible) plus a test file.",
    files: (name) => [
      {
        dir: srcDir,
        file: `${name}.js`,
        body: `${HEADER} (template: endpoint)

/**
 * Handle a request and return { status, body }.
 * TODO: implement the ${name} endpoint.
 */
export async function handle${pascal(name)}(request) {
  return { status: 501, body: { error: "${name}: not implemented" } };
}
`,
      },
      testFile(
        name,
        `import { handle${pascal(name)} } from "../src/${name}.js";`,
        `assert.equal(typeof handle${pascal(name)}, "function");`,
      ),
    ],
  },
  test: {
    description: "Only a test file for an existing module in workspace/src.",
    files: (name) => [
      testFile(
        name,
        `import * as mod from "../src/${name}.js";`,
        `assert.ok(Object.keys(mod).length > 0);`,
      ),
    ],
  },
};

const server = new McpServer({ name: "fake-harness", version: "1.0.0" });

server.registerTool(
  "list_templates",
  {
    title: "List templates",
    description: "List the code templates the harness can generate.",
    inputSchema: {},
  },
  async () =>
    text(
      Object.entries(templates)
        .map(([key, t]) => `- ${key}: ${t.description}`)
        .join("\n"),
    ),
);

server.registerTool(
  "generate",
  {
    title: "Generate code",
    description:
      "Generate starter code from a harness template into workspace/src and workspace/test. Always use this to create new modules instead of writing them from scratch.",
    inputSchema: {
      template: z
        .enum(Object.keys(templates) as [string, ...string[]])
        .describe("Template name from list_templates"),
      name: z
        .string()
        .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "use kebab-case, e.g. order-total")
        .describe("Module name in kebab-case, e.g. order-total"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Replace files that already exist (default false)"),
    },
  },
  async ({ template, name, overwrite }) => {
    const files = templates[template].files(name);
    if (!overwrite) {
      for (const f of files) {
        const target = path.join(f.dir, f.file);
        if (await exists(target)) {
          return text(
            `${path.relative(projectRoot, target)} already exists. Pass overwrite: true to replace it.`,
            true,
          );
        }
      }
    }
    const written: string[] = [];
    for (const f of files) {
      await mkdir(f.dir, { recursive: true });
      const target = path.join(f.dir, f.file);
      await writeFile(target, f.body, "utf8");
      written.push(path.relative(projectRoot, target));
    }
    return text(
      `Generated ${template} "${name}":\n${written.map((w) => `- ${w}`).join("\n")}`,
    );
  },
);

server.registerTool(
  "build",
  {
    title: "Build from a command and a requirement",
    description:
      "Generate working code from a command (function, class, endpoint, test, or any other kind) and a requirement. Writes workspace/src and workspace/test, then runs tests and lint.",
    inputSchema: {
      command: z
        .string()
        .min(1)
        .describe("Kind of code, such as function, class, endpoint, or test"),
      requirement: z.string().min(1).describe("What the code must do"),
      name: z
        .string()
        .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
        .optional()
        .describe("Optional kebab-case module name"),
      overwrite: z.boolean().optional().describe("Replace files that already exist"),
    },
  },
  async ({ command, requirement, name, overwrite }) => {
    try {
      const result = await build({
        command,
        requirement,
        name,
        overwrite,
        workspace,
        generate: generateLocally,
      });
      const summary = [
        `name: ${result.name}`,
        result.files.map((file) => `- workspace/${file}`).join("\n"),
        result.tests,
        result.lint,
      ].join("\n");
      return text(summary, !result.ok);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  },
);

server.registerTool(
  "run_tests",
  {
    title: "Run tests",
    description:
      "Run the workspace test suite with node --test and report pass/fail counts and failure output.",
    inputSchema: {
      filter: z
        .string()
        .optional()
        .describe("Only run test files whose name contains this text"),
    },
  },
  async ({ filter }) => {
    const report = await runTests(workspace, filter);
    if (report.files === 0) return text(report.output);
    return text(formatTests(report), report.status === "FAIL");
  },
);

server.registerTool(
  "lint",
  {
    title: "Lint",
    description:
      "Check workspace/src against the harness house rules (header, no console.log, no var, no leftover TODO or not-implemented stubs, max 100 chars per line).",
    inputSchema: {
      file: z
        .string()
        .optional()
        .describe("Only lint this file name in workspace/src, e.g. order-total.js"),
    },
  },
  async ({ file }) => {
    if (!(await exists(srcDir))) return text("Nothing to lint: workspace/src is empty.");
    const report = await lintWorkspace(workspace, file);
    if (report.fileCount === 0) return text(`No source file matches ${file ?? "workspace/src"}.`, true);
    return text(formatLint(report.issues, report.fileCount), report.issues.length > 0);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`fake-harness MCP server ready (workspace: ${workspace})`);
