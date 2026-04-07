#!/usr/bin/env bash
# Pre-commit policy check for ai-devs4 repo
# Blocks commits containing flags, hub URLs, or lesson content

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

VIOLATIONS=0
DIFF=$(git diff --cached --diff-filter=ACMR -U0 -- ':!.claude/skills/policy-check/*' | grep '^+' | grep -v '^+++' || true)

if [[ -z "$DIFF" ]]; then
  echo -e "${GREEN}OK${NC} No additions to check."
  exit 0
fi

# Filter out lines that are regex patterns / match() calls (legitimate code)
CONTENT=$(echo "$DIFF" | grep -v 'match(' | grep -v 'regex' | grep -v 'replace(' | grep -v 'grep' || true)

check_literal() {
  local label="$1" pattern="$2"
  local hits
  hits=$(echo "$CONTENT" | grep -F "$pattern" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo -e "${RED}BLOCKED${NC} [$label]"
    echo "$hits" | head -5 | sed 's/^/  /'
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
}

echo "Policy check..."

# 1. Flag values (literal {FLG: prefix — not regex patterns)
check_literal "FLAG VALUE" '{FLG:'

# 2. Hub domain
check_literal "HUB DOMAIN" 'hub.ag3nts.org'

# 3. Hardcoded API key assignments
check_literal "API KEY LITERAL" 'AG3NTS_API_KEY="'

if [[ $VIOLATIONS -gt 0 ]]; then
  echo -e "\n${RED}$VIOLATIONS policy violation(s). Commit aborted.${NC}"
  echo "Move secrets to env vars or redact before committing."
  exit 1
fi

echo -e "${GREEN}OK${NC} No policy violations."
exit 0
