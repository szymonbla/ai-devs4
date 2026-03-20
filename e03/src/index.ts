import "./env.js";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import OpenAI from "openai";
import ngrok from "@ngrok/ngrok";
import { runAgent } from "./agent.js";
import { PORT } from "./constants.js";
import { marcinSystemPrompt as SYSTEM_PROMPT } from "./prompts/loadPrompt.js";

// Klient do wysyłania zapytań do modelu językowego (przez OpenRouter, nie bezpośrednio OpenAI)
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SESSIONS_DIR = join(process.cwd(), "sessions");
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR);

function loadSession(id: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const path = join(SESSIONS_DIR, `${id}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

function saveSession(id: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
  writeFileSync(join(SESSIONS_DIR, `${id}.json`), JSON.stringify(messages, null, 2));
}

// Serwer HTTP — nasłuchuje na zapytania przychodzące z zewnątrz (np. od huba AI_DEVS)
// Wyobraź sobie serwer jako recepcjonistę: czeka na telefon (zapytanie), odbiera, odpowiada
const server = http.createServer(async (req, res) => {
  // Akceptujemy tylko metodę POST (wysyłanie danych), nie GET (pobieranie stron)
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ msg: "Method not allowed" }));
    return;
  }

  try {
    // Wczytujemy body zapytania (dane przychodzą w kawałkach, łączymy je w całość)
    const body = await new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    // Parsujemy JSON — spodziewamy się: { sessionID: "abc123", msg: "Sprawdź paczkę" }
    const { sessionID, msg } = JSON.parse(body) as { sessionID: string; msg: string };
    console.log(`\n═══ [${sessionID}] user: ${msg}`);

    const messages = loadSession(sessionID);
    messages.push({ role: "user", content: msg });

    // Uruchom agenta — wyśle wiadomości do modelu, wykona narzędzia jeśli potrzeba, zwróci odpowiedź
    const reply = await runAgent(client, messages);
    saveSession(sessionID, messages);
    console.log(`═══ [${sessionID}] assistant: ${reply}`);

    // Wyślij odpowiedź z powrotem do tego kto zapytał
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ msg: reply }));
  } catch (err) {
    console.error("Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ msg: "Internal error" }));
  }
});

// Rejestracja serwera w hubie AI_DEVS — informujemy hub pod jakim publicznym URL jesteśmy dostępni
async function registerWithHub(publicUrl: string) {
  const sessionID = `session-${Date.now()}`;
  const payload = {
    apikey: process.env.AG3NTS_API_KEY,
    task: "proxy",
    answer: { url: publicUrl, sessionID },
  };

  const res = await fetch(`${process.env.HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return data;
}

// Uruchom serwer na porcie 3000, a po starcie:
server.listen(PORT, async () => {
  // ngrok to tunel — nasz serwer działa lokalnie (localhost:3000), ale zewnętrzny świat
  // nie może się do niego dostać bo jest za firewallem/routerem.
  // ngrok tworzy publiczny URL (np. https://abc123.ngrok.io) który przekierowuje ruch do localhost:3000.
  // To jak "dziura w murze" — ktoś z internetu puka do ngrok, ngrok przekazuje do nas.
  const listener = await ngrok.forward({ addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN });
  const publicUrl = listener.url()!;
  console.log(`Serwer dostępny publicznie pod: ${publicUrl}`);

  // Zgłoś publiczny URL do huba żeby hub wiedział gdzie wysyłać rozmowy
  const result = await registerWithHub(publicUrl);
  console.log("Odpowiedź huba:", result);
});
