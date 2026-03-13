---
name: to-issues
description: Converts a goal or task description into a structured JSON plan file inside the exercise's plans/ directory. Use when user wants to create a plan, break down a task into steps, or generate a plan file from a goal or task description.
---

# To Issues

## Quick start

User provides a goal/task. Detect exercise context (e.g. `e01/`, `e02/`), create `<exercise>/plans/<kebab-case-title>.json`.

## Workflow

1. Detect exercise directory from context (current file, git status, or ask)
2. If task requires external connections (APIs, DBs, services) — ask clarifying questions before proceeding
3. Break task into commands with user-flow, error, and behavior scenarios
4. Write `<exercise>/plans/<kebab-case-title>.json` following the schema below
5. Create `plans/` inside the exercise dir if it doesn't exist
6. Report the file path

## Output format

Follow `.claude/skills/to-issues/prd-example.json` exactly — JSON array of objects:

```json
[
  {
    "command": "command-name",
    "category": "user-flow | error | behavior",
    "description": "What this scenario tests",
    "tested": false,
    "steps": [
      "Step 1 description",
      "Step 2 description"
    ]
  }
]
```

## Rules

- Steps must be concrete and actionable
- Steps ordered from first to last
- File named `<kebab-case-title>.json`
- Ask questions when external connections (APIs, DBs, services) are involved
