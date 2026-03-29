import "./env.js";
import OpenAI from "openai";
import { execSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { TASK, CLASSIFY_MODEL, DATA_URL, SENSOR_FIELD_MAP } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const DATA_DIR = resolve(import.meta.dirname, "../data");

const classifier = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type SensorRecord = {
  filename: string; // e.g. "0001"
  sensor_type: string;
  temperature_K: number;
  pressure_bar: number;
  water_level_meters: number;
  voltage_supply_v: number;
  humidity_percent: number;
  operator_notes: string;
};

// Module state shared across tool calls
let programmaticAnomalyIds: string[] = [];
let cleanRecords: SensorRecord[] = [];
let finalAnomalyIds: string[] = [];

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_data",
      description: "Download sensors.zip from the data URL, unzip it, and return the number of sensor files found.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_sensors",
      description: "Programmatically validate all sensor JSON files: check inactive fields are 0 and active fields are within known ranges. Returns anomaly count and clean record count.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "classify_notes",
      description: "Send clean (programmatically valid) sensor records to LLM in batches to detect inconsistent operator notes. Merges with programmatic anomalies into final list.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the final list of anomalous sensor IDs to /verify.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async fetch_data() {
    await mkdir(DATA_DIR, { recursive: true });
    const zipPath = resolve(DATA_DIR, "sensors.zip");
    const extractDir = resolve(DATA_DIR, "sensors");

    console.log(`[fetch_data] downloading ${DATA_URL}`);
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await writeFile(zipPath, Buffer.from(buf));
    console.log(`[fetch_data] saved ${buf.byteLength} bytes to ${zipPath}`);

    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe" });
    const files = await readdir(extractDir, { recursive: true });
    const jsonFiles = files.filter((f) => f.toString().endsWith(".json"));
    console.log(`[fetch_data] extracted ${jsonFiles.length} JSON files`);
    return { fileCount: jsonFiles.length };
  },

  async analyze_sensors() {
    const extractDir = resolve(DATA_DIR, "sensors");
    const entries = await readdir(extractDir, { recursive: true, withFileTypes: true });
    const jsonPaths = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => resolve(e.parentPath, e.name));

    console.log(`[analyze_sensors] processing ${jsonPaths.length} files`);
    programmaticAnomalyIds = [];
    cleanRecords = [];

    for (const filePath of jsonPaths) {
      const filename = basename(filePath, ".json");
      const raw = await readFile(filePath, "utf-8");
      let data: Omit<SensorRecord, "filename">;
      try {
        data = JSON.parse(raw) as Omit<SensorRecord, "filename">;
      } catch {
        console.warn(`[analyze_sensors] invalid JSON: ${filePath}`);
        programmaticAnomalyIds.push(filename);
        continue;
      }

      const record: SensorRecord = { filename, ...data };
      const activeSensorNames = record.sensor_type.split("/").map((s) => s.trim().toLowerCase());
      let isAnomaly = false;

      for (const [sensorName, { field, min, max }] of Object.entries(SENSOR_FIELD_MAP)) {
        const value = record[field as keyof SensorRecord] as number;
        if (activeSensorNames.includes(sensorName)) {
          if (value < min || value > max) {
            isAnomaly = true;
            break;
          }
        } else {
          if (value !== 0) {
            isAnomaly = true;
            break;
          }
        }
      }

      if (isAnomaly) {
        programmaticAnomalyIds.push(filename);
      } else {
        cleanRecords.push(record);
      }
    }

    console.log(`[analyze_sensors] programmatic anomalies: ${programmaticAnomalyIds.length}, clean: ${cleanRecords.length}`);
    console.log(`[analyze_sensors] anomaly IDs sample: ${programmaticAnomalyIds.slice(0, 10).join(", ")}`);
    return { anomalyCount: programmaticAnomalyIds.length, cleanCount: cleanRecords.length, sampleAnomalyIds: programmaticAnomalyIds.slice(0, 20) };
  },

  async classify_notes() {
    // Ensure final list has at minimum the programmatic anomalies
    finalAnomalyIds = [...programmaticAnomalyIds];

    // Deduplicate by operator_notes — same note always yields same LLM verdict
    const noteMap = new Map<string, string[]>(); // note → [filename, ...]
    for (const record of cleanRecords) {
      const note = record.operator_notes;
      if (!noteMap.has(note)) noteMap.set(note, []);
      noteMap.get(note)!.push(record.filename);
    }

    // Build unique (note, sensor_type, values) tuples to send to LLM
    const uniqueNoteRecords = [...noteMap.keys()].map((note) => {
      const filename = noteMap.get(note)![0];
      const record = cleanRecords.find((r) => r.filename === filename)!;
      return {
        filename,
        sensor_type: record.sensor_type,
        temperature_K: record.temperature_K,
        pressure_bar: record.pressure_bar,
        water_level_meters: record.water_level_meters,
        voltage_supply_v: record.voltage_supply_v,
        humidity_percent: record.humidity_percent,
        operator_notes: note,
      };
    });

    console.log(`[classify_notes] unique notes: ${uniqueNoteRecords.length} (from ${cleanRecords.length} clean records)`);

    const BATCH_SIZE = 20;
    const anomalousNotes = new Set<string>();

    const systemPrompt = `You analyze sensor readings from an industrial plant.
All records below have PASSED technical validation — their measurements are within valid ranges and inactive sensors correctly show 0.
Your ONLY task: find records where operator_notes report a problem, error, failure, alert, or malfunction — when the data is actually fine.
These are false reports by the operator (anomaly type: operator error).

Return JSON: {"anomalies": ["filename1", "filename2"]}
Return empty array if no such records found. No explanations.`;

    for (let i = 0; i < uniqueNoteRecords.length; i += BATCH_SIZE) {
      const batch = uniqueNoteRecords.slice(i, i + BATCH_SIZE);

      const response = await classifier.chat.completions.create({
        model: CLASSIFY_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(batch) },
        ],
      });

      const rawContent = response.choices[0].message.content ?? "{}";
      // Strip markdown code blocks if present
      const content = rawContent.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        console.warn(`[classify_notes] batch ${Math.floor(i / BATCH_SIZE) + 1} parse error: ${content.slice(0, 200)}`);
        continue;
      }

      const ids: string[] = Array.isArray(parsed)
        ? (parsed as string[])
        : Array.isArray((parsed as Record<string, unknown>).anomalies)
        ? ((parsed as Record<string, unknown>).anomalies as string[])
        : (Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v)) as string[] | undefined) ?? [];

      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[classify_notes] batch ${batchNum}/${Math.ceil(uniqueNoteRecords.length / BATCH_SIZE)}: found ${ids.length} anomalies${ids.length > 0 ? " → " + ids.join(", ") : ""}`);

      for (const id of ids) {
        const rec = batch.find((r) => r.filename === id);
        if (!rec) {
          console.warn(`[classify_notes] unknown filename in LLM response: ${id}`);
          continue;
        }
        const filenames = noteMap.get(rec.operator_notes) ?? [];
        for (const fn of filenames) anomalousNotes.add(fn);
      }
    }

    finalAnomalyIds = [...new Set([...programmaticAnomalyIds, ...anomalousNotes])];
    console.log(`[classify_notes] FINAL: ${finalAnomalyIds.length} anomalies (programmatic: ${programmaticAnomalyIds.length}, llm: ${anomalousNotes.size})`);
    return { totalAnomalies: finalAnomalyIds.length, llmAnomalies: anomalousNotes.size };
  },

  async submit_answer() {
    console.log(`[submit_answer] submitting ${finalAnomalyIds.length} anomaly IDs`);
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer: { recheck: finalAnomalyIds } }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("*** FLAG:", match[0], "***");
    return data;
  },
};
