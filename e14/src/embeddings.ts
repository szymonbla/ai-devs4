import OpenAI from "openai";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const BATCH_SIZE = 500;
const WORKSPACE_DIR = resolve(import.meta.dirname, "../workspace");

function textsHash(texts: string[]): string {
  return createHash("sha256").update(texts.join("\n")).digest("hex").slice(0, 16);
}

function getCachePath(hash: string): string {
  return resolve(WORKSPACE_DIR, `embeddings-${hash}.json`);
}

export async function computeEmbeddings(texts: string[]): Promise<number[][]> {
  if (!existsSync(WORKSPACE_DIR)) mkdirSync(WORKSPACE_DIR, { recursive: true });

  const hash = textsHash(texts);
  const cachePath = getCachePath(hash);

  if (existsSync(cachePath)) {
    console.log(`[embeddings] cache hit (${cachePath})`);
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  }

  console.log(`[embeddings] cache miss, computing...`);
  const all: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    console.log(`[embeddings] batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} (${batch.length} items)...`);
    const res = await openai.embeddings.create({
      model: "openai/text-embedding-3-small",
      input: batch,
    });
    for (let j = 0; j < res.data.length; j++) {
      all[i + j] = res.data[j].embedding;
    }
  }

  writeFileSync(cachePath, JSON.stringify(all));
  console.log(`[embeddings] cached to ${cachePath}`);
  return all;
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "openai/text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function findBestMatch(queryEmb: number[], itemEmbs: number[], names: string[]): { name: string; score: number } | null {
  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < itemEmbs.length; i++) {
    const score = cosine(queryEmb, itemEmbs[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestScore < 0.3) return null;
  return { name: names[bestIdx], score: bestScore };
}
