---
name: run-once
description: Run a task once and return the result. Use when user wants to run a task once and return the result.
---

# Run Once

## Quick start

User provides a plan name. Run the task once and return the result.
## Workflow

1. Read the @plans/plan-name.json file
2. Find the next incomplete step (tested: false) and implement it
3. Update the step status to true
4. Return the result

ONLY DO THE TASK AT A TIME. DO NOT RUN MULTIPLE STEPS AT ONCE.

## Output format

```json
{
  "result": "The result of the task"
}
```