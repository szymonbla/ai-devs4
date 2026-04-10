import "./env.js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import OpenAI from "openai";
import { tools, handlers, scrapeToWorkspace, callOkoApi, WORKSPACE_DIR } from "./tools.js";
import { MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ── Phase 1: scrape all pages ─────────────────────────────────────────────────

console.log("\n═══ PHASE 1: scraping OKO panel ═══");
await scrapeToWorkspace();

// ── Phase 2: read workspace files into context ────────────────────────────────

console.log("\n═══ PHASE 2: building context from workspace ═══");

const files = readdirSync(WORKSPACE_DIR).filter((f) => f.endsWith(".txt")).sort();
const context = files
  .map((f) => {
    const content = readFileSync(join(WORKSPACE_DIR, f), "utf-8");
    return `=== FILE: ${f} ===\n${content}`;
  })
  .join("\n\n");

console.log(`[context] loaded ${files.length} files`);

// ── Phase 3: get help response ────────────────────────────────────────────────

console.log("\n═══ PHASE 3: fetching API help ═══");
const helpResponse = await callOkoApi("help");
const helpText = JSON.stringify(helpResponse, null, 2);
console.log("[help]", helpText.slice(0, 500));

// ── Phase 4: agent loop — only API calls ─────────────────────────────────────

console.log("\n═══ PHASE 4: agent making updates ═══");

const SYSTEM_PROMPT = `You are an autonomous agent editing the OKO incident-monitoring system.

## Tools
- read_panel_page: fetch live panel page to check current state
- call_oko_api: make API calls (help/update/done)

## API help
${helpText}

## Key rules
- BEFORE making any change, use read_panel_page to check current state of the relevant record.
- If the API returns an error (code < 0), read the "message" field — it tells you exactly what is wrong. Fix and retry.
- done field is ONLY valid for page=zadania. Never send done= for incydenty or notatki.
- Prefix codes in titles: read /notatki/<id> pages to get the full coding rules before choosing a prefix.
- Content requirements: the notatki coding page specifies required hashtags (e.g. #zwierzeta) that MUST appear in the content of matching incident types. Read the notatki coding page carefully and include the required hashtag(s) in every content update.
- Titles must contain the city name.
- For action=done: call it ONLY after all updates are confirmed successful.

## Scraped panel content (may be stale — verify with read_panel_page before acting)
${context}`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: `Work through ALL required changes iteratively:

STEP 1: Read /notatki/380792b2c86d9c5be670b3bde48e187b — this page contains the full prefix and content hashtag rules. Extract:
  - The correct 6-char prefix code for animal incidents
  - The correct 6-char prefix code for human movement incidents
  - The required hashtag(s) for each incident type (e.g. #zwierzeta for animals)

STEP 2: Update Skolwin incydent (id=380792b2c86d9c5be670b3bde48e187b, page=incydenty):
  - title: correct animal prefix + "Skolwin"
  - content: description of beaver activity along the river. MUST include the required hashtag for animals (e.g. #zwierzeta).

STEP 3: Update Skolwin zadanie (id=380792b2c86d9c5be670b3bde48e187b, page=zadania):
  - done: "YES"
  - content: confirmation that beavers were identified.

STEP 4: Add new incydent for human movement near Komarowo (page=incydenty, no id = new record):
  - title: correct human-movement prefix + "Komarowo"
  - content: description of detected human movement. MUST include the required hashtag for human movement from the notatki rules.

STEP 5: Call action="done" to get the flag.

After EACH call_oko_api call: if the response contains code < 0, the "message" field tells you exactly what is wrong (it may include the missing hashtag). Fix it and retry that call immediately.`,
  },
];

for (let i = 0; i < 20; i++) {
  console.log(`\n── iteration ${i + 1} ──`);
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no tool calls → done");
    console.log("Agent:", msg.content);
    const flagMatch = msg.content?.match(/\{FLG:[^}]+\}/);
    if (flagMatch) console.log("\n FLAG:", flagMatch[0]);
    break;
  }

  console.log(`<- ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   - ${tc.function.name}(${tc.function.arguments.slice(0, 160)})`);
  }

  let gotFlag = false;
  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`   + ${name} -> ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "..." : ""}`);
        const flagMatch = resultStr.match(/\{FLG:[^}]+\}/);
        if (flagMatch) { console.log("\n FLAG:", flagMatch[0]); gotFlag = true; }
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   x ${name} -> Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
  if (gotFlag) break;
}
