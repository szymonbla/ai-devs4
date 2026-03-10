#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE "^npm "; then
  echo "Blocked: use pnpm instead of npm" >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE "^npx "; then
  echo "Blocked: use pnpm exec instead of npx" >&2
  exit 2
fi

exit 0