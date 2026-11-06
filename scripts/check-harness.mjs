import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, slugFromRequirement } from "../harness/engine.ts";
import { generateLocally } from "../harness/local.ts";

assert.equal(slugFromRequirement("order total with tax"), "order-total-tax");

const scratch = await mkdtemp(path.join(tmpdir(), "fake-harness-"));

const source = `export function addTwoNumbers(left, right) {
  return left + right;
}
`;
const test = `import { test } from "node:test";
import assert from "node:assert/strict";
import { addTwoNumbers } from "../src/add-two-numbers.js";

test("adds two numbers", () => {
  assert.equal(addTwoNumbers(2, 3), 5);
});
`;

try {
  let calls = 0;
  const result = await build({
    command: "function",
    requirement: "add two numbers",
    workspace: scratch,
    generate: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          files: [
            { path: "src/wrong.js", contents: `${source}\n// TODO drop this\n` },
            { path: "test/wrong.test.js", contents: test },
          ],
        });
      }
      return JSON.stringify({
        files: [
          { path: "src/add-two-numbers.js", contents: source },
          { path: "test/add-two-numbers.test.js", contents: test },
        ],
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, ["src/add-two-numbers.js", "test/add-two-numbers.test.js"]);
  assert.match(result.tests, /^PASS/);

  await assert.rejects(
    () =>
      build({
        command: "function",
        requirement: "add two numbers",
        workspace: scratch,
        generate: async () => {
          throw new Error("should not generate when the file exists");
        },
      }),
    /already exists/,
  );

  await assert.rejects(
    () =>
      build({
        command: "function",
        requirement: "write outside",
        name: "escaped",
        workspace: scratch,
        overwrite: true,
        repairs: 0,
        generate: async () =>
          JSON.stringify({
            files: [{ path: "../package.json", contents: "{}" }],
          }),
      }),
    /Refusing/,
  );

  const transport = new StdioClientTransport({
    command: "node",
    args: ["harness/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "harness-check", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("build"));
    assert.ok(names.includes("generate"));
  } finally {
    await client.close();
  }

  const localDir = await mkdtemp(path.join(tmpdir(), "fake-harness-local-"));
  try {
    const added = await build({
      command: "function",
      requirement: "add 2 numbers",
      workspace: localDir,
      generate: generateLocally,
    });
    assert.equal(added.ok, true);
    const source = await readFile(path.join(localDir, "src", "add-2-numbers.js"), "utf8");
    assert.match(source, /return left \+ right/);
    assert.doesNotMatch(source, /claude/i);

    const total = await build({
      command: "function",
      requirement: "order total with tax and a percentage discount",
      workspace: localDir,
      generate: generateLocally,
    });
    assert.equal(total.ok, true);
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }

  console.log("harness check passed");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
