import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL } from "./constants.js";

// Klient OpenAI skierowany na OpenRouter — pozwala używać różnych modeli przez jedno API
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// Inicjalna konwersacja: system prompt definiuje CEL agenta, user message daje pierwszy impuls
// Kluczowe: nie podajemy dokumentacji API — model ma ją odkryć sam przez akcję "help"
const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content:
      "You are activating railway route X-01 via a self-documenting API. " +
      "Start by calling the help action to discover available actions and parameters. " +
      "Follow the API docs exactly — use exact action names and params from the docs. " +
      "Work step by step through the API to activate route X-01. " +
      "When you get a flag ({FLG:...}), report it as your final answer.",
  },
  { role: "user", content: "Activate route X-01. Begin with the help action." },
];

// === PĘTLA AGENTOWA ===
// Model sam decyduje: wywołać narzędzie (tool_call) albo odpowiedzieć tekstem (koniec).
// Max 25 iteracji jako zabezpieczenie przed nieskończoną pętlą.
for (let i = 0; i < 25; i++) {
  console.log(`\n[krok ${i + 1}] Wysyłam ${messages.length} wiadomości`);

  // Wysyłamy CAŁĄ historię konwersacji — model widzi wszystkie wcześniejsze wywołania i wyniki
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,              // dostępne narzędzia
    tool_choice: "auto", // model sam decyduje czy wywołać narzędzie
  });

  const msg = response.choices[0].message;
  messages.push(msg); // dodaj odpowiedź modelu do historii

  // Brak tool_calls = model uznał, że skończył — wypisz odpowiedź i zakończ
  if (!msg.tool_calls?.length) {
    console.log("[koniec] Brak wywołań narzędzi");
    console.log("[odpowiedź]", msg.content);
    break;
  }

  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`[wywołanie] ${tc.function.name}(${tc.function.arguments})`);
  }

  // Wykonaj wszystkie wywołania narzędzi równolegle i zwróć wyniki do modelu
  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`[wynik] ${name} → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "..." : ""}`);
        // Wynik narzędzia wraca jako wiadomość "tool" powiązana z tool_call_id
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`[błąd] ${name} → ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  // Dopisz wyniki narzędzi do historii — w następnej iteracji model je zobaczy
  messages.push(...results);
}
