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
  const filtered = raw
    .split("\n")
    .filter((line) => !/\b(INFO|DEBUG)\b/.test(line))
    .join("\n");
  writeFileSync(FILTERED_LOG, filtered);
  console.log(`Filtered log: ${filtered.split("\n").length} lines, ${filtered.length} chars`);

  // Clear result log
  writeFileSync(RESULT_LOG, "");
}

await fetchAndFilter();

// ── Step 2: Run main agent ──

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const handlers = createHandlers(client);

const SYSTEM_PROMPT = `You are an agent analyzing power plant failure logs. Your goal: produce a compressed log (max ${MAX_TOKENS} tokens) containing ONLY events relevant to the failure.

## Context
A power plant experienced a failure. The logs have been pre-filtered (INFO/DEBUG removed). You need to find all significant events related to: power systems, cooling, water pumps, software errors, safety systems, and any other subsystems that show anomalies.

## Tools
- search_logs(query): Search filtered logs via a subagent. Use descriptive queries.
- set_log(content): Replace the entire result log. Lines auto-sorted by timestamp.
- get_current_log(): View current result log
- count_tokens(): Check token count (must stay under ${MAX_TOKENS})
- submit_answer(): Submit to Centrala for verification

## Procedure
1. Search logs systematically by subsystem: power, cooling, water/pumps, software/errors, safety, sensors, pressure, temperature, valves, alarms, emergency, critical events, warnings
2. For each search, identify significant events and add them to the result log
3. Paraphrase/shorten descriptions to save tokens while preserving: timestamp, severity, subsystem ID
4. Check token count regularly — stay well under ${MAX_TOKENS}
5. After covering all subsystems, submit the answer
6. Read Centrala's feedback carefully — if something is missing, search for it and add it
7. If over token limit, clear and rebuild with more concise entries
8. Iterate until you receive a flag {FLG:...}

## Important
- Be thorough: search for ALL subsystems, not just obvious ones
- Be concise: paraphrase aggressively to fit within token budget
- Preserve chronological order where possible
- Each entry must have timestamp, severity, and subsystem identifier`;

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
