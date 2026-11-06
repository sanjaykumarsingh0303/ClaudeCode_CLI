# Claude Code CLI MCP practice

Notes for this folder are in [notes/index.html](notes/index.html).

## Generate code

The generic harness takes a command and a requirement, writes the module and its tests into `workspace/` itself, then runs them.

```bash
npm run harness -- function "order total with tax and a percentage discount"
npm run harness -- class "shopping cart that adds items and returns a total"
npm run harness -- endpoint "health check that returns status ok"
```

The first word is the command (`function`, `class`, `endpoint`, `test`, or any other kind of code). The rest is the requirement. Add `--name order-total` to choose the file name, or `--overwrite` to replace files that already exist.

Inside Claude Code, the same thing is:

```text
/gen function order total with tax and a percentage discount
```

`/gen` calls the `build` tool on the `fake-harness` MCP server. The harness writes `workspace/src` and `workspace/test` itself, then runs the tests and lint.

## Practice notes

A local notebook MCP server you can connect from Claude Code in this folder.

The server speaks MCP over stdin/stdout. Claude Code starts it from `.mcp.json` when you launch `claude` here. It exposes four tools (`add_note`, `list_notes`, `search_notes`, `delete_note`), one resource (`notes://all`), and one prompt (`summarize_notes`). Notes are written to `data/notes.json`.

## Setup

```bash
npm install
npm run check
```

`npm run check` starts the server, lists its tools, and saves a throwaway note. It does not write into `data/`.

## Practice in Claude Code

From this folder:

```bash
claude
```

On the first launch, approve the project server `practice-notes`. Then try:

1. Add a note titled "first drill" that says you connected an MCP server.
2. List the notes and repeat the id back.
3. Search notes for "drill".
4. Read the `notes://all` resource.
5. Run the `summarize_notes` prompt.
6. Delete the note you just created.

Inside the session, `/mcp` shows whether `practice-notes` is connected. Outside the session:

```bash
claude mcp list
claude mcp get practice-notes
```

## What this config does

`.mcp.json` is project scope. It is the file you would commit so everyone who clones the repo gets the same server. Claude Code runs:

```bash
node src/server.ts
```

and talks JSON-RPC on that process's stdin and stdout. Logs go to stderr only. `CLAUDE_PROJECT_DIR` is set by Claude Code to this folder, and the server stores notes there.

Other scopes, if you want to try them later:

| Scope | Command | Stored in |
| --- | --- | --- |
| Local (default, private to you and this folder) | `claude mcp add --scope local ...` | `~/.claude.json` |
| Project (shared) | the `.mcp.json` already in this folder | `.mcp.json` |
| User (all your projects) | `claude mcp add --scope user ...` | `~/.claude.json` |

`claude mcp serve` is the other direction: Claude Code itself becomes an MCP server for another client. You do not need it for this drill.
