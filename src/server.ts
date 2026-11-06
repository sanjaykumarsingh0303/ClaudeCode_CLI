import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot =
  process.env.CLAUDE_PROJECT_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const notesPath =
  process.env.NOTES_PATH ?? path.join(projectRoot, "data", "notes.json");

type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
};

async function readNotes(): Promise<Note[]> {
  try {
    const raw = await readFile(notesPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeNotes(notes: Note[]): Promise<void> {
  await mkdir(path.dirname(notesPath), { recursive: true });
  await writeFile(notesPath, JSON.stringify(notes, null, 2) + "\n", "utf8");
}

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

const server = new McpServer({
  name: "practice-notes",
  version: "1.0.0",
});

server.registerTool(
  "add_note",
  {
    title: "Add a note",
    description: "Save a note in the local practice notebook.",
    inputSchema: {
      title: z.string().min(1).describe("Short title"),
      body: z.string().min(1).describe("Note text"),
    },
  },
  async ({ title, body }) => {
    const notes = await readNotes();
    const note: Note = {
      id: randomUUID(),
      title,
      body,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    await writeNotes(notes);
    return text(`Saved note ${note.id}: ${note.title}`);
  },
);

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description: "List every note in the practice notebook.",
    inputSchema: {},
  },
  async () => {
    const notes = await readNotes();
    if (notes.length === 0) return text("The notebook is empty.");
    const lines = notes.map(
      (note) => `- ${note.id} | ${note.createdAt} | ${note.title}: ${note.body}`,
    );
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "search_notes",
  {
    title: "Search notes",
    description: "Find notes whose title or body contains the query.",
    inputSchema: {
      query: z.string().min(1).describe("Text to search for"),
    },
  },
  async ({ query }) => {
    const needle = query.toLowerCase();
    const matches = (await readNotes()).filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle),
    );
    if (matches.length === 0) return text(`No notes matched "${query}".`);
    const lines = matches.map((note) => `- ${note.id} | ${note.title}: ${note.body}`);
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "delete_note",
  {
    title: "Delete a note",
    description: "Delete one note by its id.",
    inputSchema: {
      id: z.string().min(1).describe("Note id returned by add_note or list_notes"),
    },
  },
  async ({ id }) => {
    const notes = await readNotes();
    const next = notes.filter((note) => note.id !== id);
    if (next.length === notes.length) return text(`No note with id ${id}.`);
    await writeNotes(next);
    return text(`Deleted note ${id}.`);
  },
);

server.registerTool(
  "update_note",
  {
    title: "Update a note",
    description:
      "Change the title and/or body of one note by its id. Fields you omit stay the same.",
    inputSchema: {
      id: z.string().min(1).describe("Note id returned by add_note or list_notes"),
      title: z.string().min(1).optional().describe("New title (optional)"),
      body: z.string().min(1).optional().describe("New note text (optional)"),
    },
    
  },
  async ({ id, title, body }) => {
    if (title === undefined && body === undefined) {
      return {
        ...text("Nothing to update: pass a new title, a new body, or both."),
        isError: true,
      };
    }
    const notes = await readNotes();
    const note = notes.find((n) => n.id === id);
    if (!note) return { ...text(`No note with id ${id}.`), isError: true };
    if (title !== undefined) note.title = title;
    if (body !== undefined) note.body = body;
    note.updatedAt = new Date().toISOString();
    await writeNotes(notes);
    return text(`Updated note ${note.id}: ${note.title}: ${note.body}`);
  },
);

server.registerResource(
  "notebook",
  "notes://all",
  {
    title: "Practice notebook",
    description: "Every saved note as JSON.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await readNotes(), null, 2),
      },
    ],
  }),
);

server.registerPrompt(
  "summarize_notes",
  {
    title: "Summarize notes",
    description: "Ask Claude to summarize the practice notebook.",
    argsSchema: {
      focus: z.string().optional().describe("Optional topic to emphasize"),
    },
  },
  ({ focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Read the practice notebook with the list_notes tool.",
            focus
              ? `Summarize it with extra attention to: ${focus}.`
              : "Summarize every note in a few bullets.",
          ].join(" "),
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`practice-notes MCP server ready (notes: ${notesPath})`);
