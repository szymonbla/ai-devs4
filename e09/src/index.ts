import "./env.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { tools, findTool } from "./tools.js";
import { AGENT_MODEL, MAX_ITERATIONS } from "./constants.js";
import { openai } from "./config.js";

const truncate = (s: string, max = 100): string =>
  s.length > max ? s.slice(0, max) + '…' : s


async function runAgent() {
  try {
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }));

    const systemContent =
      "You are an autonomous agent. Use the tools available to you to accomplish the user's task. Think step by step and use tools to explore, gather information, and submit answers.";

    const userContent =
      "Search the mailbox and find three values: the password to the employee system, the planned attack date on the power plant (YYYY-MM-DD format), and the security confirmation code (starts with SEC-). Start by calling call_zmail with action='help' to learn the available API actions. The mailbox is live — if something is missing, wait and retry. Submit partial answers to get feedback on which fields are correct.";

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];

    for (let turn = 0; turn < MAX_ITERATIONS; turn++) {
      console.log(
        `\n── iteracja ${turn + 1} ── wysyłam ${messages.length} wiadomości...`,
      );
      const response = await openai.chat.completions.create({
        model: AGENT_MODEL,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      });

      const message = response.choices[0]?.message;
      if (!message) return "Agent error: No response from model";

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      if (!message.tool_calls?.length) {
        console.log("\n── brak wywołań narzędzi → koniec");
        console.log("Agent:", message.content);
        return message.content ?? "";
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") continue;

        const name = toolCall.function.name;
        let args: Record<string, unknown> = {};
        try {
          const raw = toolCall.function.arguments;
          args =
            typeof raw === "string" && raw.trim()
              ? (JSON.parse(raw) as Record<string, unknown>)
              : {};
        } catch {
          args = {};
        }

        console.log(`[Tool: ${name}(${truncate(JSON.stringify(args))})`);

        const tool = findTool(name);
        const result = tool
          ? await tool.handler(args)
          : `Unknown tool: ${name}`;

        console.log(
          `   ✓ ${name} → ${result.slice(0, 120)}${result.length > 120 ? "…" : ""}`,
        );

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    return "Agent exceeded maximum turns";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error:`, msg);
    return `Agent error: ${msg}`;
  }
}

runAgent();
