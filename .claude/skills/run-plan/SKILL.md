---
name: run-plan
description: Implements the next untested item from a plan JSON file (created by to-issues skill), marks it tested: true, and saves the file. Use when user wants to run, execute, or work through the next step in a plan file, or says "next step", "run next", "implement next item".
---

# Run Plan

## Quick start

Point at a plan file and run the next untested item:

```
/run-plan e02/plans/findhim.json
```

Or with no argument — detect from context (git status, current exercise dir).

## Workflow

1. **Locate plan file**
   - Use argument if provided
   - Otherwise infer from context: look for `plans/*.json` in the current exercise dir
   - If multiple files found, list them and ask which one

2. **Find next item**
   - Read the JSON array
   - Pick the first object where `"tested": false`
   - If all items are tested → report "All items completed" and stop

3. **Show item to user**
   - Print: `command`, `category`, `description`, and numbered `steps`
   - Ask for confirmation before implementing (unless user said "just do it")

4. **Implement the item**
   - Follow the steps literally — write code, make API calls, update files
   - Use existing project conventions (check nearby source files first)

5. **Mark tested**
   - Set `"tested": true` on that item in the JSON file
   - Save the file

6. **Report**
   - One-line summary of what was done
   - Show how many items remain (`X of N still untested`)

## Rules

- Run **exactly one item** per invocation — never batch multiple items
- Do not alter any other fields in the JSON (command, category, description, steps)
- If implementation fails or is unclear, stop and ask — do not mark `tested: true` until done
- Preserve JSON formatting (2-space indent, trailing newline)
