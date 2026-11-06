import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./engine.ts";
import { generateLocally } from "./local.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(): never {
  console.error(`Usage: npm run harness -- <command> <requirement> [--name kebab-name] [--overwrite]

Commands you can pass: function, class, endpoint, test, or any other kind of code.

Examples:
  npm run harness -- function "order total with tax and a percentage discount"
  npm run harness -- class "shopping cart that adds items and returns a total"
  npm run harness -- endpoint "health check that returns status ok"
`);
  process.exit(1);
}

const args = process.argv.slice(2);
let overwrite = false;
let name: string | undefined;
const words: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--overwrite") {
    overwrite = true;
  } else if (arg === "--name") {
    name = args[index + 1];
    index += 1;
  } else {
    words.push(arg);
  }
}

const [command, ...rest] = words;
const requirement = rest.join(" ").trim();
if (!command || !requirement) usage();

const workspace = process.env.HARNESS_WORKSPACE ?? path.join(projectRoot, "workspace");
const result = await build({
  command,
  requirement,
  name,
  overwrite,
  workspace,
  generate: generateLocally,
});

console.log(`name: ${result.name}`);
console.log(result.files.map((file) => `- workspace/${file}`).join("\n"));
console.log(result.tests);
console.log(result.lint);
if (!result.ok) process.exit(1);
