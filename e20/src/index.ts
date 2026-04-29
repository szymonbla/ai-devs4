import "./env.js";
import fs from "fs";
import nodePath from "path";
import OpenAI from "openai";
import { MODEL, MAX_STEPS, TASK } from "./constants.js";
import { tools, handlers, WORKSPACE } from "./tools.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

async function bootstrapHelp() {
  const helpPath = nodePath.join(WORKSPACE, "help.json");
  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer: { tool: "help" } }),
  });
  const data = await res.json();
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(helpPath, JSON.stringify(data, null, 2));
  console.log("[bootstrap] help.json saved");
}

await bootstrapHelp();

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const systemPrompt = fs
  .readFileSync(nodePath.join(WORKSPACE, "system/agents/foodwarehouse.md"), "utf8")
  .replace("{{FOOD4CITIES_URL}}", `${HUB_URL}/dane/food4cities.json`);

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: systemPrompt },
  { role: "user", content: "Execute the foodwarehouse task. Follow the workflow in your system prompt step by step." },
];

for (let i = 0; i < MAX_STEPS; i++) {
  console.log(`\n── step ${i + 1}/${MAX_STEPS} ──`);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no tool calls → agent finished");
    if (msg.content) console.log("Agent:", msg.content);
    break;
  }

  console.log(`← ${msg.tool_calls.length} tool call(s):`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function")
      console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 120)})`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function")
        return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const s = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`   ✓ ${name} → ${s.slice(0, 200)}${s.length > 200 ? "…" : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: s };
      } catch (err) {
        const errMsg = `Error: ${(err as Error).message}`;
        console.log(`   ✗ ${name} → ${errMsg}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: errMsg };
      }
    })
  );

  messages.push(...results);
}
