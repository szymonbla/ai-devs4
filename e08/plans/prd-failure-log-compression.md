## Problem Statement

A power plant experienced a failure. Full system logs from that day exist but are too large to fit in an LLM context window. Technicians need a compressed version (max 1500 tokens) containing only events relevant to failure analysis (power, cooling, water pumps, software, other subsystems). The compressed log must be submitted to Centrala for verification; technicians return precise feedback on what's missing, enabling iterative refinement until a flag is received.

## Solution

An autonomous agent that fetches the raw log file, pre-filters it, explores it via a subagent, builds a compressed result log, counts tokens, submits to Centrala, and iterates on feedback until the flag is obtained.

## User Stories

1. As an operator, I want the agent to fetch the raw log file automatically, so that I don't need to manually download it
2. As an operator, I want INFO/DEBUG lines stripped before analysis, so that the agent focuses only on significant events
3. As an operator, I want a subagent to semantically search pre-filtered logs by query, so that relevant events across subsystems are found
4. As an operator, I want the subagent to grep logs by keyword, so that specific subsystem events are located quickly
5. As an operator, I want the subagent to read specific line ranges, so that context around found events is understood
6. As an operator, I want the main agent to build the result log incrementally (one entry at a time), so that each entry is deliberate
7. As an operator, I want the agent to view the current result log at any time, so that it can assess completeness
8. As an operator, I want the agent to count tokens of the result log using a heuristic, so that it stays under 1500 tokens
9. As an operator, I want the agent to clear the result log and rebuild it, so that feedback-driven corrections are possible
10. As an operator, I want the agent to submit the result log to Centrala automatically, so that verification is hands-free
11. As an operator, I want the agent to read Centrala's feedback and adjust the log accordingly, so that missing subsystems are added
12. As an operator, I want the agent to iterate submit-fix-submit cycles until a flag is received, so that the task completes autonomously
13. As an operator, I want each log entry to preserve timestamp (YYYY-MM-DD HH:MM), severity level, and subsystem ID, so that technicians can analyze the failure timeline
14. As an operator, I want entries to be paraphrased/shortened where possible, so that the 1500 token budget is used efficiently

## Implementation Decisions

### Architecture: Two-tier agent

- **Pre-step (deterministic, before agent loop):**
  - Fetch `failure.log` from `REDACTED_URL{API_KEY}/failure.log`
  - Regex filter: remove lines matching INFO/DEBUG severity, keep everything else
  - Save result to `data/filtered.log`

- **Main agent (gpt-4o-mini via OpenRouter, max 20 iterations):**
  - Orchestrates the entire process
  - Tools:
    - `search_logs(query: string)` — spawns subagent to search filtered.log, returns matching lines
    - `add_to_log(entry: string)` — appends one line to `data/result.log`
    - `get_current_log()` — returns contents of `data/result.log`
    - `count_tokens()` — returns token count of `data/result.log` using heuristic `Math.ceil(text.length / 3.5)`
    - `clear_log()` — empties `data/result.log`
    - `submit_answer()` — reads `data/result.log`, POSTs to Centrala verify endpoint with task "failure"

- **Subagent (gpt-4o-mini via OpenRouter, max 10 iterations):**
  - Invoked inside `search_logs` tool handler
  - Receives a search query from main agent
  - Tools:
    - `grep_logs(keyword: string)` — regex search over `data/filtered.log`, returns matching lines with line numbers
    - `read_lines(from: number, to: number)` — reads a range of lines from `data/filtered.log`
  - Returns found relevant lines to main agent

### Token counting

- Heuristic: `Math.ceil(text.length / 3.5)` — conservative estimate, no native dependencies needed
- Agent should target staying well under 1500 to account for heuristic imprecision

### Log format

- One event per line, separated by `\n`
- Each line preserves: `[YYYY-MM-DD HH:MM] [SEVERITY] SUBSYSTEM_ID description`
- Agent may paraphrase/shorten descriptions to save tokens

### Submit format

- POST to `REDACTED_URL`
- Body: `{ "apikey": KEY, "task": "failure", "answer": { "logs": "line1\nline2\n..." } }`

## Testing Decisions

- No automated tests for this exercise — it's a one-shot agent task verified by Centrala's feedback loop
- Manual verification: run `pnpm start` and observe agent achieving the flag
- Token counting can be spot-checked against OpenAI's tokenizer page

## Out of Scope

- Graph-based memory or neo4j integration
- Observational Memory patterns from the lesson
- Deep Research / long-form generation
- Persisting results across runs
- Using expensive models (o1, gpt-4o, opus)

## Further Notes

- The lesson discusses Observational Memory and knowledge base design patterns, but the task itself is a focused log compression exercise
- Centrala feedback is described as "very precise" — the agent should parse it and use it to guide which subsystems to search for next
- The pre-filter step is critical: raw file is too large even for large-context models, regex eliminates bulk before any LLM involvement
