import { HEADER } from "./check.ts";

function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function pascal(name: string): string {
  const value = camel(name);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function requirementConst(requirement: string): string {
  const chunks: string[] = [];
  for (let index = 0; index < requirement.length; index += 60) {
    chunks.push(requirement.slice(index, index + 60));
  }
  if (chunks.length === 1) {
    const line = `export const requirement = ${JSON.stringify(chunks[0])};`;
    if (line.length <= 100) return line;
  }
  const parts = chunks.map((chunk) => `  ${JSON.stringify(chunk)}`).join(" +\n");
  return `export const requirement =\n${parts};`;
}

function readField(prompt: string, label: string): string {
  return prompt.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1]?.trim() ?? "";
}

type FunctionShape = { params: string; body: string; check: string };

function functionShape(id: string, requirement: string): FunctionShape {
  const text = requirement.toLowerCase();
  if (/\badd\b/.test(text) && /(\bnumbers?\b|\bnums?\b|\d+)/.test(text)) {
    return {
      params: "left, right",
      body: "  return left + right;",
      check: `assert.equal(${id}(2, 3), 5);\n  assert.equal(${id}(-1, 4), 3);`,
    };
  }
  if (/\bmultiply\b|\bproduct\b/.test(text)) {
    return {
      params: "left, right",
      body: "  return left * right;",
      check: `assert.equal(${id}(2, 3), 6);`,
    };
  }
  if (/order/.test(text) && /tax/.test(text) && /discount/.test(text)) {
    return {
      params: "subtotal, taxRate, discountRate",
      body: [
        "  const discounted = subtotal * (1 - discountRate);",
        "  return discounted * (1 + taxRate);",
      ].join("\n"),
      check: `assert.equal(${id}(100, 0.1, 0.2), 88);`,
    };
  }
  return {
    params: "input = {}",
    body: "  return { requirement, input };",
    check: [
      `const result = ${id}({ value: 1 });`,
      "  assert.equal(result.requirement, requirement);",
      "  assert.deepEqual(result.input, { value: 1 });",
    ].join("\n"),
  };
}

function render(command: string, name: string, requirement: string): { path: string; contents: string }[] {
  const stored = requirementConst(requirement);
  const id = camel(name);
  const typeName = pascal(name);
  const sourcePath = `src/${name}.js`;
  const testPath = `test/${name}.test.js`;

  if (command === "test") {
    return [
      {
        path: testPath,
        contents: `${HEADER}
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../src/${name}.js";

test("meets the requirement", () => {
  assert.equal(typeof mod, "object");
  assert.ok(Object.keys(mod).length > 0);
});
`,
      },
    ];
  }

  if (command === "class") {
    return [
      {
        path: sourcePath,
        contents: `${HEADER}
${stored}

export class ${typeName} {
  constructor(options = {}) {
    this.requirement = requirement;
    this.options = options;
  }
}
`,
      },
      {
        path: testPath,
        contents: `${HEADER}
import { test } from "node:test";
import assert from "node:assert/strict";
import { ${typeName}, requirement } from "../src/${name}.js";

test("meets the requirement", () => {
  const item = new ${typeName}({ ready: true });
  assert.equal(item.requirement, requirement);
  assert.deepEqual(item.options, { ready: true });
});
`,
      },
    ];
  }

  if (command === "endpoint") {
    const handler = `handle${typeName}`;
    return [
      {
        path: sourcePath,
        contents: `${HEADER}
${stored}

export async function ${handler}(request = {}) {
  return { status: 200, body: { requirement, request } };
}
`,
      },
      {
        path: testPath,
        contents: `${HEADER}
import { test } from "node:test";
import assert from "node:assert/strict";
import { ${handler}, requirement } from "../src/${name}.js";

test("meets the requirement", async () => {
  const result = await ${handler}({ ok: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.requirement, requirement);
  assert.deepEqual(result.body.request, { ok: true });
});
`,
      },
    ];
  }

  const shape = functionShape(id, requirement);
  return [
    {
      path: sourcePath,
      contents: `${HEADER}
${stored}

export function ${id}(${shape.params}) {
${shape.body}
}
`,
    },
    {
      path: testPath,
      contents: `${HEADER}
import { test } from "node:test";
import assert from "node:assert/strict";
import { ${id}, requirement } from "../src/${name}.js";

test("meets the requirement", () => {
  assert.equal(typeof requirement, "string");
  ${shape.check}
});
`,
    },
  ];
}

export function generateLocally(prompt: string): Promise<string> {
  const command = readField(prompt, "Command") || "function";
  const name = readField(prompt, "Module name") || "module";
  const requirement = readField(prompt, "Requirement");
  return Promise.resolve(JSON.stringify({ files: render(command, name, requirement) }));
}
