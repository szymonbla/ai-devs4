import "./env.js";
import http from "http";
import ngrok from "@ngrok/ngrok";
import { allItemNames, getCitiesForItem } from "./data.js";
import { computeEmbeddings, embedQuery, findBestMatch } from "./embeddings.js";

const PORT = 3000;
const HUB_URL = process.env.HUB_URL!;
const API_KEY = process.env.AG3NTS_API_KEY!;
const TASK = "negotiations";

const TOOL_DESCRIPTION =
  "Search tool that finds cities selling a specific item. Send the item name or description in natural language in the params field (e.g. 'resistor 1 ohm' or 'I need a 10m cable'). Returns a list of city names where the item is available for purchase.";

// Pre-compute embeddings
console.log("[startup] computing embeddings for all items...");
const itemEmbeddings = await computeEmbeddings(allItemNames);
console.log(`[startup] ${itemEmbeddings.length} embeddings ready`);

// HTTP server
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  const body = await new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  console.log(`[request] ${req.method} ${req.url} → ${body}`);

  try {
    const parsed = JSON.parse(body);
    const query = parsed.params ?? parsed.query ?? "";

    if (!query) {
      const output = "Please provide an item description in the 'params' field.";
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ output }));
      return;
    }

    const queryEmb = await embedQuery(query);
    const match = findBestMatch(queryEmb, itemEmbeddings, allItemNames);

    let output: string;
    if (!match) {
      output = "No matching item found. Try a different description.";
    } else {
      const cities = getCitiesForItem(match.name);
      output = `Item: ${match.name} → Cities: ${cities.join(", ")}`;
      // Truncate if over 500 bytes
      if (Buffer.byteLength(output) > 500) {
        while (Buffer.byteLength(output) > 490) {
          const parts = output.split(", ");
          parts.pop();
          output = parts.join(", ");
        }
      }
    }

    console.log(`[response] ${output.slice(0, 200)}`);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ output }));
  } catch (err) {
    console.error("[error]", err);
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ output: "Invalid request format." }));
  }
});

server.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));

// ngrok tunnel
const listener = await ngrok.forward({ addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN });
const publicUrl = listener.url()!;
console.log(`[ngrok] tunnel: ${publicUrl}`);

// Register tool with centrala
const toolUrl = `${publicUrl}/api/search`;
const registerPayload = {
  apikey: API_KEY,
  task: TASK,
  answer: {
    tools: [
      {
        URL: toolUrl,
        description: TOOL_DESCRIPTION,
      },
    ],
  },
};

console.log("[register] sending tool registration...");
const regRes = await fetch(`${HUB_URL}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(registerPayload),
});
const regData = await regRes.json();
console.log("[register] response:", JSON.stringify(regData));

// Wait for agent to use our tool, then check
console.log("[check] waiting 60s for agent to work...");
await new Promise((r) => setTimeout(r, 60_000));

console.log("[check] polling for result...");
const checkRes = await fetch(`${HUB_URL}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { action: "check" } }),
});
const checkData = await checkRes.json();
console.log("[check] result:", JSON.stringify(checkData));

const flagMatch = JSON.stringify(checkData).match(/\{FLG:[^}]+\}/);
if (flagMatch) console.log("\nFlag:", flagMatch[0]);

process.exit(0);
