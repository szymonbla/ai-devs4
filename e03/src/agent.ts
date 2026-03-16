import type OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL, MAX_ITERATIONS } from "./constants.js";

// Pętla agenta — serce całego systemu
// Przyjmuje historię wiadomości (messages) i zwraca odpowiedź tekstową
// Pętla trwa dopóki model nie przestanie wołać narzędzi (lub do MAX_ITERATIONS)
export async function runAgent(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Wyślij całą historię rozmowy do modelu razem z listą dostępnych narzędzi
    // Model może odpowiedzieć tekstem ALBO powiedzieć "chcę wywołać narzędzie X z argumentami Y"
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,           // lista narzędzi które model może wywołać (check_package, redirect_package)
      tool_choice: "auto", // model sam decyduje kiedy użyć narzędzia
    });

    const msg = response.choices[0].message;
    // Dodaj odpowiedź modelu do historii (ważne — model musi widzieć swoje poprzednie odpowiedzi)
    messages.push(msg);

    // Jeśli model nie chce wywoływać żadnych narzędzi — to jest finalna odpowiedź, koniec pętli
    if (!msg.tool_calls?.length) {
      return msg.content ?? "";
    }

    // Model chce wywołać jedno lub więcej narzędzi — wykonaj je wszystkie równolegle (Promise.all)
    const results = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };

        const { name, arguments: argsStr } = tc.function;
        // Argumenty przychodzą jako JSON string, np. '{"packageid":"PKG001"}'
        const args = JSON.parse(argsStr) as Record<string, unknown>;

        try {
          // Wywołaj odpowiedni handler (np. check_package lub redirect_package)
          const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
          // Wynik narzędzia też trafia do historii — model zobaczy go w następnej iteracji
          return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
        } catch (err) {
          return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
        }
      }),
    );

    // Dodaj wyniki narzędzi do historii i wróć na początek pętli
    // W następnej iteracji model zobaczy: swoje zapytanie o narzędzie + wynik narzędzia → i odpowie
    messages.push(...results);
  }

  return "Max iterations reached";
}
