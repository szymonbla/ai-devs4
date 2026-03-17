import type OpenAI from "openai";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = "REDACTED_HUB_URL";

// === DEFINICJA NARZĘDZIA ===
// Jedno uniwersalne narzędzie do komunikacji z API kolejowym.
// Model sam odkrywa dostępne akcje przez action="help".
// Opis (description) jest kluczowy — to jedyna "instrukcja obsługi" jaką model dostaje.
export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "call_railway_api",
      description:
        "Call the railway API with an action and optional params. Start with action='help' to discover available actions.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "The API action to call (e.g. help, reconfigure, getstatus, setstatus, save)" },
          route: { type: "string", description: "Route identifier, e.g. x-01" },
          value: { type: "string", description: "Status value for setstatus: RTOPEN or RTCLOSE" },
        },
        required: ["action"],
        additionalProperties: true, // pozwala modelowi wysłać dodatkowe pola odkryte przez help
      },
    },
  },
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// === RETRY Z EXPONENTIAL BACKOFF ===
// Zewnętrzne API bywają niestabilne. Ta funkcja automatycznie ponawia request gdy:
// - serwer zwraca 503 (niedostępny)
// - trafiamy na rate limit (za dużo requestów)
// Delay rośnie wykładniczo (2s → 4s → 8s → ...) do max 30s
async function callWithRetry(body: unknown): Promise<{ data: unknown; headers: Headers }> {
  const MAX_RETRIES = 10;
  let delay = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 503) {
      const waitMs = parseInt(res.headers.get("retry-after") ?? "0", 10) * 1000 || delay;
      console.log(`[503] ${attempt}/${MAX_RETRIES}, retry ${waitMs}ms`);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 30000);
      continue;
    }

    const remaining = res.headers.get("x-ratelimit-remaining");
    const retryAfter = res.headers.get("retry-after");
    const data = await res.json() as Record<string, unknown>;

    if (data.code === -985 || (remaining && parseInt(remaining, 10) <= 0)) {
      const waitMs = Math.max(parseInt(retryAfter ?? "2", 10) * 1000, 2000);
      console.log(`[limit] retry ${waitMs}ms`);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 30000);
      continue;
    }

    return { data, headers: res.headers };
  }

  throw new Error("Max retries exceeded (503)");
}

// === HANDLERY NARZĘDZI ===
// Każdy handler odpowiada jednemu narzędziu z tablicy `tools`.
// Model wywołuje narzędzie → handler wykonuje akcję → wynik wraca do modelu.
export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {

  // Główne narzędzie — wysyła akcję do API kolejowego
  // Model sam decyduje jakie argumenty wysłać (action, route, value, ...)
  async call_railway_api(args) {
    const body = {
      apikey,
      task: TASK,
      answer: args, // argumenty od modelu lecą jako "answer" do API
    };
    console.log(`[→] ${JSON.stringify(args)}`);

    const { data } = await callWithRetry(body);
    const resp = data as Record<string, unknown>;
    // Pretty-print response: skip verbose nested objects for readability
    if (resp.action === "help" && resp.help) {
      const help = resp.help as Record<string, unknown>;
      const actions = (help.actions as Array<Record<string, unknown>>)?.map(
        (a) => `  ${a.action}(${(a.requires as string[])?.join(", ") || ""}) — ${a.about}`
      );
      console.log(`[←] actions:\n${actions?.join("\n")}`);
      if (help.route_format) console.log(`  route: ${help.route_format}`);
      if (help.notes) console.log(`  notes: ${(help.notes as string[]).join("; ")}`);
    } else {
      console.log(`[←] ${JSON.stringify(resp)}`);
    }
    const text = JSON.stringify(data);

    // Szukamy flagi w odpowiedzi — to znak sukcesu
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log(`[flaga] ${match[0]}`);

    return data; // wynik wraca do modelu jako tool result
  },

  // Alternatywny handler do bezpośredniego wysyłania odpowiedzi
  async submit_answer({ answer }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log(`[flaga] ${match[0]}`);
    return data;
  },
};
