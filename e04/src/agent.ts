import type OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL, MAX_ITERATIONS } from "./constants.js";

export async function runAgent(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return msg.content ?? "";
    }

    const results = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };

        const { name, arguments: argsStr } = tc.function;
        const args = JSON.parse(argsStr) as Record<string, unknown>;

        try {
          const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
          return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
        } catch (err) {
          return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
        }
      }),
    );

    messages.push(...results);
  }

  return "Max iterations reached";
}
