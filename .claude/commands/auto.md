---
description: Generate working code from a command and a requirement, then report the harness result
argument-hint: "<command> <requirement>"
allowed-tools: mcp__fake-harness__build, Read
---

Task: $ARGUMENTS

The first word is the command. The rest is the requirement. If either is missing, ask for both and stop.

Call the fake-harness `build` tool once. It writes the module, writes the tests, and retries when tests or lint fail.

Then report the files, the test result, and the lint result. Do not write a new module yourself.
