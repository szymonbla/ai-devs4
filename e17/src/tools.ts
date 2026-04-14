import "./env.js";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type OpenAI from "openai";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const WORKSPACE = join(process.cwd(), "workspace");
mkdirSync(WORKSPACE, { recursive: true });

// ── Core API caller ───────────────────────────────────────────────────────────

async function callApi(action: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = { apikey, task: TASK, answer: { action, ...params } };
  console.log(`[api] ${action}`, JSON.stringify(params ?? {}).slice(0, 150));
  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as Record<string, unknown>;
  console.log(`[api] ← ${action}:`, JSON.stringify(data).slice(0, 200));
  const flagMatch = JSON.stringify(data).match(/\{FLG:[^}]+\}/);
  if (flagMatch) console.log("🚩 Flag:", flagMatch[0]);
  return data;
}

// ── Queue drain ───────────────────────────────────────────────────────────────

async function drainQueue(expectedCount: number, maxWaitMs = 35000): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const deadline = Date.now() + maxWaitMs;

  while (results.length < expectedCount && Date.now() < deadline) {
    const resp = await callApi("getResult");
    const code = Number(resp?.code);

    if (code === 11) {
      console.log(`[drain] waiting (${results.length}/${expectedCount}), retry in 500ms`);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    if (code < 0) {
      console.error(`[drain] error ${code}: ${resp?.message}`);
      break;
    }

    console.log(`[drain] ✓ ${results.length + 1}/${expectedCount} sourceFunction=${resp?.sourceFunction}`);
    results.push(resp);
  }

  return results;
}

// ── Analysis (runs in code, not LLM) ─────────────────────────────────────────

type ConfigEntry = {
  startDate: string;
  startHour: string;
  windMs: number;
  pitchAngle: number;
  turbineMode: "production" | "idle";
};

function getUpperYieldPct(yieldTable: Array<Record<string, unknown>>, windMs: number): number {
  let best: Record<string, unknown> | null = null;
  let bestDiff = Infinity;
  for (const entry of yieldTable) {
    const diff = Math.abs(windMs - Number(entry.windMs));
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  if (!best) return 0;
  const parts = String(best.yieldPercent).split("-");
  return parseFloat(parts[parts.length - 1]);
}

function buildConfigEntries(
  doc: Record<string, unknown>,
  weather: Record<string, unknown>,
  powerplant: Record<string, unknown>
): ConfigEntry[] {
  const maxWindSpeed = Number(
    doc.maxWindSpeed ?? doc.maximumWindMs ?? doc.maxOperatingWindMs ?? doc.stormWindMs ?? 20
  );
  const ratedPowerKw = Number(doc.ratedPowerKw ?? 14);
  const yieldTable = (doc.windPowerYieldPercent ?? []) as Array<Record<string, unknown>>;
  // API accepts only 0, 45, 90 — default to 45 for production
  const optimalPitchAngle = Number(
    doc.optimalPitchAngle ?? doc.productionPitchAngle ?? doc.nominalPitchAngle ?? 45
  );

  const deficitStr = String(powerplant.powerDeficitKw ?? "4-5");
  const powerDeficitKw = parseFloat(deficitStr.split("-").pop()!);

  console.log(`[analysis] maxWindSpeed=${maxWindSpeed} ratedPower=${ratedPowerKw}kW deficit=${powerDeficitKw}kW optimalPitch=${optimalPitchAngle}`);

  const forecast = (weather.forecast ?? []) as Array<Record<string, unknown>>;
  const entries: ConfigEntry[] = [];
  let prevStorm = false;
  let productionSet = false;

  for (const point of forecast) {
    const windMs = Number(point.windMs ?? point.wind ?? 0);
    const ts = String(point.timestamp ?? point.time ?? "");
    const normalized = ts.replace("T", " ");
    const [datePart, timePart = "00:00:00"] = normalized.split(" ");
    const startDate = datePart;
    const startHour = `${timePart.slice(0, 2)}:00:00`;
    const isStorm = windMs > maxWindSpeed;

    if (isStorm && !prevStorm) {
      entries.push({ startDate, startHour, windMs, pitchAngle: 90, turbineMode: "idle" });
      console.log(`[analysis] storm start ${startDate} ${startHour} windMs=${windMs}`);
    }

    if (!isStorm && !productionSet) {
      const yieldPct = getUpperYieldPct(yieldTable, windMs);
      const powerKw = ratedPowerKw * yieldPct / 100;
      if (powerKw >= powerDeficitKw) {
        entries.push({ startDate, startHour, windMs, pitchAngle: optimalPitchAngle, turbineMode: "production" });
        productionSet = true;
        console.log(`[analysis] production ${startDate} ${startHour} windMs=${windMs} power=${powerKw.toFixed(1)}kW`);
      }
    }

    prevStorm = isStorm;
  }

  if (!productionSet) throw new Error("[analysis] no production slot found — check documentation fields and yield table");
  console.log(`[analysis] ${entries.length} config entries total`);
  return entries;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "prepare_session",
      description:
        "CALL FIRST. Loads cached documentation (pre-session), starts 40s window, fetches weather + powerplantcheck in parallel, analyzes forecast in code, queues all unlock codes + turbinecheck in parallel, drains everything. Returns {configs, turbinecheck}.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_and_done",
      description:
        "CALL SECOND. Pass configs exactly as returned by prepare_session. Submits the batch config, then calls done. Returns final API response with flag.",
      parameters: {
        type: "object",
        properties: {
          configs: {
            type: "object",
            description: "Exact configs object returned by prepare_session.",
          },
        },
        required: ["configs"],
      },
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  prepare_session: async () => {
    // 1. Load documentation from cache or fetch (outside 40s window)
    const docPath = join(WORKSPACE, "documentation.json");
    let doc: Record<string, unknown>;
    if (existsSync(docPath)) {
      doc = JSON.parse(readFileSync(docPath, "utf-8")) as Record<string, unknown>;
      console.log("[prepare] documentation loaded from cache");
    } else {
      doc = await callApi("get", { param: "documentation" });
      writeFileSync(docPath, JSON.stringify(doc, null, 2));
      console.log("[prepare] documentation fetched and cached");
    }

    // 2. Start session (40s timer begins here)
    await callApi("start");

    // 3. Parallel: weather + powerplantcheck
    await Promise.all([
      callApi("get", { param: "weather" }),
      callApi("get", { param: "powerplantcheck" }),
    ]);

    // 4. Drain 2 async results
    const two = await drainQueue(2);
    const weather = two.find(r => r.sourceFunction === "weather")!;
    const powerplant = two.find(r => r.sourceFunction === "powerplantcheck")!;

    // Save for debugging
    writeFileSync(join(WORKSPACE, "session-data.json"), JSON.stringify({ doc, weather, powerplant }, null, 2));

    // 5. Analyze forecast in code → config entries
    const entries = buildConfigEntries(doc, weather, powerplant);

    // 6. Parallel: all unlock codes + turbinecheck
    const queueResponses = await Promise.all([
      ...entries.map(e =>
        callApi("unlockCodeGenerator", {
          startDate: e.startDate,
          startHour: e.startHour,
          windMs: e.windMs,
          pitchAngle: e.pitchAngle,
        })
      ),
      callApi("get", { param: "turbinecheck" }),
    ]);

    // Count only successfully queued jobs (positive codes = queued)
    const queuedCount = queueResponses.filter(r => Number(r.code) > 0).length;
    console.log(`[prepare] queued ${queuedCount}/${queueResponses.length} jobs (${queueResponses.length - queuedCount} rejected)`);

    // 7. Drain only the jobs that were actually queued
    const all = await drainQueue(queuedCount);
    const turbinecheck = all.find(r => r.sourceFunction === "turbinecheck");
    const unlockResults = all.filter(r => r.sourceFunction === "unlockCodeGenerator");

    // 8. Build final configs map with unlockCodes
    const configs: Record<string, unknown> = {};
    for (const entry of entries) {
      const match = unlockResults.find(r => {
        const sp = r.signedParams as Record<string, unknown> | undefined;
        return (
          sp?.startDate === entry.startDate &&
          sp?.startHour === entry.startHour &&
          Number(sp?.pitchAngle) === entry.pitchAngle &&
          Number(sp?.windMs) === entry.windMs
        );
      });
      const key = `${entry.startDate} ${entry.startHour}`;
      configs[key] = {
        pitchAngle: entry.pitchAngle,
        turbineMode: entry.turbineMode,
        unlockCode: match?.unlockCode ?? null,
      };
      console.log(`[prepare] ${key} pitchAngle=${entry.pitchAngle} mode=${entry.turbineMode} unlockCode=${match?.unlockCode ?? "MISSING"}`);
    }

    return { configs, turbinecheck };
  },

  submit_and_done: async ({ configs }) => {
    const submitResp = await callApi("config", { configs });
    console.log("[submit]", JSON.stringify(submitResp).slice(0, 150));
    return callApi("done");
  },
};
