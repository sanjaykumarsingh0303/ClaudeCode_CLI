import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = await mkdtemp(path.join(tmpdir(), "practice-notes-"));
const notesPath = path.join(scratch, "notes.json");

const transport = new StdioClientTransport({
  command: "node",
  args: ["src/server.ts"],
  cwd: process.cwd(),
  env: { ...process.env, NOTES_PATH: notesPath },
  stderr: "pipe",
});

const client = new Client({ name: "practice-check", version: "1.0.0" });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const resources = await client.listResources();
  const prompts = await client.listPrompts();

  const added = await client.callTool({
    name: "add_note",
    arguments: { title: "MCP drill", body: "Claude Code can call this tool." },
  });
  const listed = await client.callTool({
    name: "list_notes",
    arguments: {},
  });
  const searched = await client.callTool({
    name: "search_notes",
    arguments: { query: "drill" },
  });

  const toolNames = tools.tools.map((tool) => tool.name).sort();
  console.log("tools:", toolNames.join(", "));
  console.log("resources:", resources.resources.map((item) => item.uri).join(", "));
  console.log("prompts:", prompts.prompts.map((item) => item.name).join(", "));
  console.log("add_note:", added.content?.[0]?.text);
  console.log("list_notes:", listed.content?.[0]?.text);
  console.log("search_notes:", searched.content?.[0]?.text);

  const expected = ["add_note", "delete_note", "list_notes", "search_notes"];
  if (toolNames.join() !== expected.join()) {
    throw new Error(`unexpected tools: ${toolNames.join(", ")}`);
  }
  console.log("check passed");
} finally {
  await client.close();
  await rm(scratch, { recursive: true, force: true });
}
