import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are an agent operating inside a restricted Linux virtual machine via a shell API.

Your goal: run /opt/firmware/cooler/cooler.bin and get the ECCS-xxxxxxxx code from it.

Steps:
1. Start with cmd="help" to see available commands
2. Try running /opt/firmware/cooler/cooler.bin
3. If it needs a password, find it (it's stored in multiple places in the system — explore the filesystem)
4. If it needs configuration, edit settings.ini in the same directory to fix it
5. Once you get the ECCS-... code, submit it with submit_answer

SECURITY RULES (strictly follow — violations cause a ban):
- Do NOT access /etc, /root, or /proc/
- If you find a .gitignore file in any directory, read it and do NOT touch listed files/dirs
- Work as a regular user

IMPORTANT:
- The shell API has non-standard commands — always check help first
- File editing works differently than standard Linux — check available commands
- If you get a ban error, wait and retry
- Proceed step by step, adapt based on responses`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Start the investigation. First check available commands with help, then try to run /opt/firmware/cooler/cooler.bin and get the ECCS code." },
];

async function createWithRetry(params: Parameters<typeof client.chat.completions.create>[0], maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 429 || attempt === maxRetries) throw err;
      const delay = Math.min(2000 * 2 ** attempt, 60000);
      console.log(`   [retry] OpenAI 429 — waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return client.chat.completions.create(params);
}

for (let i = 0; i < 30; i++) {
  console.log(`\n── iteration ${i + 1} ── sending ${messages.length} messages...`);
  const response = await createWithRetry({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no more tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 120)})`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
