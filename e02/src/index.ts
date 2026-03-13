import "./env.js";
import { readFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";

const suspects = JSON.parse(readFileSync(join(import.meta.dirname, "../data/suspects.json"), "utf-8")) as Array<{
  name: string;
  surname: string;
  birthYear: number;
}>;

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const suspectList = suspects.map((s) => `${s.name} ${s.surname} (born ${s.birthYear})`).join("\n");

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a field intelligence agent. Use the available tools to identify which suspect was near a nuclear power plant and submit the answer.",
  },
  {
    role: "user",
    content: `Find which suspect was closest to a nuclear power plant and submit the answer.\n\nSuspects:\n${suspectList}`,
  },
];

for (let i = 0; i < 15; i++) {
  console.log(`\n── iteracja ${i + 1} ── wysyłam ${messages.length} wiadomości do modelu...`);
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── model nie chce już żadnych narzędzi → koniec pętli");
    console.log("Agent done:", msg.content);
    break;
  }

  console.log(`\n← model odpowiedział: chce wywołać ${msg.tool_calls.length} narzędzi:`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments})`);
  }

  console.log("\n→ wykonuję lokalnie na moim komputerze...");
  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 120)}${resultStr.length > 120 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  console.log("\n→ odsyłam wyniki do modelu...");
  messages.push(...results);
}
