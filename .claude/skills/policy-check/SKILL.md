---
name: policy-check
description: Pre-commit hook enforcing ai-devs4 publishing policy — blocks flags, hub URLs, API endpoints, and lesson content from being committed. Use when setting up the repo, configuring hooks, or when user mentions policy, secrets, or sensitive data in commits.
---

# Policy Check

Pre-commit hook that blocks commits containing:
- Flag values (literal FLG tokens)
- Hub URLs or domain references
- Hardcoded API key assignments

## Install

```bash
cp .claude/skills/policy-check/scripts/check-policy.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## What passes

- Regex patterns in code that match flags (e.g. `match(...)` calls)
- Env var references (`process.env.HUB_URL`)
- Redacted placeholders

## What blocks

- Literal flag values
- Hardcoded hub endpoint URLs
- Bare domain references in non-regex context

## Bypass

```bash
git commit --no-verify  # skip hook (use sparingly)
```
