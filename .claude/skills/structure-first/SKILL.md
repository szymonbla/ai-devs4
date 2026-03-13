---
name: structure-first
description: Analyzes existing file structure and determines where new code belongs before creating any files or functions. Use when about to create a new file or function, or when asked to add functionality to a project.
---

# Structure First

**Always run this before writing any new file or function.**

## Workflow

1. **Read existing structure** — glob `src/**/*` (or equivalent) in the current exercise/project
2. **Identify patterns** — look for:
   - How responsibilities are split (pipeline/, schemas/, prompts/, tools/, etc.)
   - Naming conventions (kebab-case files, PascalCase types, etc.)
   - Where shared types and constants live
   - Whether a sibling exercise (e.g. `e01/`) exists to use as a reference
3. **Decide placement** — for each piece of new code, determine:
   - Does it belong in an existing file? (prefer extending over creating)
   - If new file: which directory, what name, what single responsibility
   - Are shared types/constants needed? Do they already exist?
4. **State the plan** — before writing anything, output the intended file layout:
   ```
   src/
     constants.ts       — add X constant
     pipeline/
       new-module.ts    — new: does Y
   ```
5. **Then implement**

## Rules

- Prefer editing existing files over creating new ones
- One responsibility per file
- Shared types go in `types.ts`, constants in `constants.ts`
- New directories only when ≥2 files share a domain (e.g. `pipeline/`, `tools/`)
- Match the naming and structure of the nearest sibling exercise
