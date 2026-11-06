---
description: Run the fake-harness test suite and explain any failures
argument-hint: "[optional filter, e.g. order-total]"
allowed-tools: mcp__fake-harness__run_tests, Read
---

Run the workspace tests with the `run_tests` tool from the fake-harness server.
If "$ARGUMENTS" is not empty, pass it as the `filter`.

Then report:
- one line with PASS/FAIL and the pass/fail counts
- for each failure: the test name, the file, and a one-sentence likely cause (read the source file if you need to)

Do not change any files. This command only reports.
