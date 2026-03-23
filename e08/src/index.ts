import "./env.js";
import OpenAI from "openai";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { tools, createHandlers } from "./tools.js";
import { AGENT_MODEL, MAX_ITERATIONS, MAX_TOKENS } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const DATA_DIR = resolve(import.meta.dirname, "../data");
const RAW_LOG = resolve(DATA_DIR, "failure.log");
const FILTERED_LOG = resolve(DATA_DIR, "filtered.log");
const RESULT_LOG = resolve(DATA_DIR, "result.log");

// ── Step 1: Fetch and pre-filter logs ──

async function fetchAndFilter() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (!existsSync(RAW_LOG)) {
    console.log("Fetching failure.log...");
    const url = `${HUB_URL}/data/${apikey}/failure.log`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
    writeFileSync(RAW_LOG, await res.text());
  }

  const raw = readFileSync(RAW_LOG, "utf-8");
  const lines = raw.split("\n").filter((line) => /\[(WARN|ERRO|CRIT)\]/.test(line));

  const filtered = lines.join("\n");
  writeFileSync(FILTERED_LOG, filtered);
  console.log(`Filtered log: ${lines.length} lines, ${filtered.length} chars`);

  // Clear result log
  writeFileSync(RESULT_LOG, "");
}

await fetchAndFilter();

// ── Step 2: Run main agent ──

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const handlers = createHandlers();

const SYSTEM_PROMPT = `You compress power plant failure logs to max ${MAX_TOKENS} tokens.

## Tools
- search_logs(query): Grep filtered logs by keyword. Returns deduplicated patterns with counts and time ranges.
- set_log(content): Replace result log entirely. Auto-sorted by timestamp.
- get_current_log(): View current result log.
- count_tokens(): Check token count — must stay under ${MAX_TOKENS}.
- submit_answer(): Submit for verification.

## Critical rules
- NEVER search twice in a row — after any search result, next call must be set_log.
- Include ALL unique patterns — never skip any, especially (x1) events.
- When compressing: shorten descriptions but NEVER remove a line and NEVER drop subsystem names or rare technical terms (e.g. SAFETY_CHECK, hardware interface map, cross-check).
- Do NOT search for INFO/DEBUG/TRACE or anything not named in feedback.
- Do NOT stop until submit_answer returns code == 0.

## Format
Each line: YYYY-MM-DD HH:MM SEV SUBSYS message (xN)
- Use FIRST timestamp from search result range
- Verbatim in initial pass; compress only if over token limit
- No square brackets; (xN) count at end`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Analyze the failure logs and produce a compressed version. Search all relevant subsystems, build the result log, and submit it." },
];

for (let i = 0; i < MAX_ITERATIONS; i++) {
  console.log(`\n── iteration ${i + 1} ──`);
  const response = await client.chat.completions.create({
    model: AGENT_MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (msg.content) console.log(`Agent: ${msg.content.slice(0, 200)}`);

  if (!msg.tool_calls?.length) {
    console.log("\n── done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 100)})`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: "unsupported" };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown: ${name}`;
        const s = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`   ✓ ${name} → ${s.slice(0, 200)}${s.length > 200 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: s };
      } catch (err) {
        const e = (err as Error).message;
        console.log(`   ✗ ${name} → ${e}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${e}` };
      }
    })
  );

  messages.push(...results);
}
