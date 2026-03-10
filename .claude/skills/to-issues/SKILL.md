---
name: to-issues
description: Converts a goal or task description into a structured plan file in the /plans folder. Use when user wants to create a plan, break down a task into steps, or generate a plan file from a goal or task description.
---

# To Issues

## Quick start

User provides a goal or task description. Create a single JSON plan file in `/plans/`.

## Workflow

1. Analyze the user's goal/task
2. Determine a concise title
3. Write a brief description summarizing the goal
4. Break it down into ordered, actionable steps (strings)
5. Write to `/plans/<kebab-case-title>.json`

## Output format

```json
{
  "title": "Short task title",
  "description": "What this plan achieves and why.",
  "steps": [
    "Step one action",
    "Step two action",
    "..."
  ]
}
```

## Rules

- Steps must be concrete and actionable, not vague
- Steps ordered from first to last
- One file per plan, named `<kebab-case-title>.json`
- Create `/plans/` directory if it doesn't exist
- Do not ask for confirmation — just create the file and report the path
- Focus only on programming related issues, not sending data or connecting to external services.
