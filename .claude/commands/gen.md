---
description: Generate working code from a command and a requirement
argument-hint: "<command> <requirement>"
allowed-tools: mcp__fake-harness__build
---

Generate working code with the fake-harness `build` tool.

Arguments: $ARGUMENTS

- The first word is the command: `function`, `class`, `endpoint`, `test`, or any other kind of code.
- Everything after that is the requirement.
- If either part is missing, show this example and stop:

  /gen function order total with tax and a percentage discount

- Call `build` with that command and requirement. Do not write the files yourself.
- Do not pass `overwrite` unless I said "overwrite".

After the tool returns, list the files and the test and lint results, then stop.
