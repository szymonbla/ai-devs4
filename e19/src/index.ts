import "./env.js";
import fs from "fs";
import nodePath from "path";
import OpenAI from "openai";
import { MODEL, MAX_STEPS } from "./constants.js";
import { callApi, createToolsAndHandlers, WORKSPACE } from "./tools.js";

async function bootstrapHelp(): Promise<string[]> {
  const capPath = nodePath.join(WORKSPACE, "ops/filesystem/api-capabilities.md");

  const response = await callApi({ action: "help" });
  const fullJson = JSON.stringify(response, null, 2);
  console.log("[help]", fullJson.slice(0, 800));

  const actions = new Set<string>(["help", "done", "reset"]);

  // Extract from batch_mode.allowed_actions
  const resp = response as Record<string, unknown>;
  const batchMode = resp?.batch_mode as Record<string, unknown> | undefined;
  if (Array.isArray(batchMode?.allowed_actions)) {
    for (const a of batchMode!.allowed_actions as string[]) actions.add(a);
  }

  // Scan full JSON for recognized action patterns
  const pat = /\b(create[A-Z]\w+|delete[A-Z]\w+|list[A-Z]\w+|read[A-Z]\w+|\w+Directory|\w+File)\b/g;
  for (const m of fullJson.matchAll(pat)) actions.add(m[1]);

  const actionList = [...actions];
  const md = `# API Capabilities\n\nRaw help response:\n\`\`\`json\n${fullJson}\n\`\`\`\n\nExtracted actions:\n${actionList.map((a) => `- ${a}`).join("\n")}\n`;
  fs.mkdirSync(nodePath.dirname(capPath), { recursive: true });
  fs.writeFileSync(capPath, md);
  console.log("[help] actions:", actionList.join(", "));

  return actionList;
}

const actions = await bootstrapHelp();
const { tools, handlers } = createToolsAndHandlers(actions);

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const systemPrompt = fs.readFileSync(
  nodePath.join(WORKSPACE, "system/agents/filesystem-agent.md"),
  "utf8"
);

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: systemPrompt },
  { role: "user", content: "Execute the filesystem task. Follow workflow.md step by step." },
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
        console.log(`   ✓ ${name} → ${s.slice(0, 160)}${s.length > 160 ? "…" : ""}`);
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
