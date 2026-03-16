import "./env.js";
import OpenAI from "openai";
import { runAgent } from "./agent.js";
import { DOCS_INDEX } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are an agent tasked with submitting a transport declaration for the SPK system.

Submit this exact declaration using submit_declaration:

SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI
======================================================
DATA: ${TODAY}
PUNKT NADAWCZY: Gdańsk
------------------------------------------------------
NADAWCA: 450202122
PUNKT DOCELOWY: Żarnowiec
TRASA: X-01
------------------------------------------------------
KATEGORIA PRZESYŁKI: A
------------------------------------------------------
OPIS ZAWARTOŚCI (max 200 znaków): kasety z paliwem do reaktora
------------------------------------------------------
DEKLAROWANA MASA (kg): 2800
------------------------------------------------------
WDP: 4
------------------------------------------------------
UWAGI SPECJALNE: brak
------------------------------------------------------
KWOTA DO ZAPŁATY: 0 PP
------------------------------------------------------
OŚWIADCZAM, ŻE PODANE INFORMACJE SĄ PRAWDZIWE.
BIORĘ NA SIEBIE KONSEKWENCJĘ ZA FAŁSZYWE OŚWIADCZENIE.
======================================================

If submission fails, read the error and try adjusting values. You can also fetch_url ${DOCS_INDEX} and follow links to find more info.
Key facts from docs:
- Base train: 2 wagons × 500 kg = 1000 kg. Extra wagons: 500 kg each, 55 PP each.
- Category A (Strategic) + B (Medical): extra wagon fees waived.
- WDP = number of additional wagons needed.
- Route X-01 (Gdańsk-Żarnowiec) is in excluded routes list but this is the correct route code.
Report the verification result.`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Fetch the SPK documentation, fill out the transport declaration, and submit it." },
];

console.log("Starting e04 sendit agent...");
const result = await runAgent(client, messages);
console.log("\nFinal result:", result);
