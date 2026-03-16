import "./env.js";
import OpenAI from "openai";
import { runAgent } from "./agent.js";
import { DOCS_INDEX } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are an SPK transport declaration agent. Your goal: fill out and submit a valid declaration.

## Capabilities
- fetch_url: fetch text documents (.md etc.)
- analyze_image: extract data from images (use for .png/.jpg files referenced in docs)
- submit_declaration: submit the completed declaration

## Constraints
- Declaration format must match the official template exactly (separators, field order, wording)
- All field values must comply with the SPK regulations
- If submission fails, read the error, adjust, and retry
- Do NOT invent data — derive everything from docs and shipment details below

## Approach
- When you encounter links to image files (.png, .jpg), use analyze_image to read them — they may contain critical data (route maps, fee tables, excluded routes)
- Follow ALL links in the documentation that could be relevant, especially appendices (zalacznik-*.md)
- Calculate fees according to the regulations, considering category exemptions
- The declaration template is in Załącznik E (zalacznik-E.md). It starts with "SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI" and uses ====== and ------ as separators. You MUST use this exact format.
- TRASA field takes ONLY the route code (e.g. "X-01"), not the full description
- WDP = number of additional wagons needed beyond the base 2. Calculate from weight: ceil((mass - 1000) / 500)
- Copy the closing oath text character-for-character from the template (watch Polish diacritics: Ę not E)
- Today's date: ${TODAY}

## Shipment details
- Sender ID: 450202122
- Origin: Gdańsk
- Destination: Żarnowiec
- Contents: kasety z paliwem do reaktora
- Weight: 2800 kg
- Budget: 0 PP (must be free or system-funded)
- Special notes: none (leave empty or "brak")
`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: `Start by fetching the SPK documentation index at ${DOCS_INDEX}. Read all referenced files (including images). Then fill out and submit the transport declaration.`,
  },
];

console.log("Starting e04 sendit agent...");
const result = await runAgent(client, messages);
console.log("\nFinal result:", result);
