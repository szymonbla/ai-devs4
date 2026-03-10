import OpenAI from "openai";
import { jobTagsSchema } from "../schemas/job-tags.js";
import { jobTaggerSystemPrompt } from "../prompts/job-tagger.js";
import { loadFilteredPeople } from "./load-people.js";
import { OPENROUTER_BASE_URL, MODEL, BATCH_SIZE, FILTER_TAG, GENDER, CITY, TASK, HUB_URL } from "../constants.js";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: OPENROUTER_BASE_URL,
});

type IndexedJob = { i: number; job: string };
type IndexedResult = { i: number; tags: string[] };

async function callModel(jobs: IndexedJob[]): Promise<IndexedResult[]> {
  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: jobTaggerSystemPrompt },
      { role: "user", content: JSON.stringify(jobs) },
    ],
    response_format: { type: "json_schema", json_schema: jobTagsSchema },
  });
  const parsed = JSON.parse(resp.choices[0].message.content!) as { results: IndexedResult[] };
  return parsed.results;
}

export async function tagJobs(jobs: string[], maxRetries = 3): Promise<string[][]> {
  const tagMap = new Map<number, string[]>();
  let pending: IndexedJob[] = jobs.map((job, i) => ({ i, job }));

  for (let attempt = 0; attempt < maxRetries && pending.length > 0; attempt++) {
    const results = await callModel(pending);
    for (const { i, tags } of results) tagMap.set(i, tags);
    pending = pending.filter(({ i }) => !tagMap.has(i));
    if (pending.length > 0) console.warn(`Retry ${attempt + 1}: missing indices ${pending.map((j) => j.i).join(", ")}`);
  }

  if (pending.length > 0) throw new Error(`Failed to tag indices: ${pending.map((j) => j.i).join(", ")}`);
  return jobs.map((_, i) => tagMap.get(i)!);
}

export async function run() {
  const filtered = loadFilteredPeople();

  const allTags: string[][] = [];
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const tags = await tagJobs(batch.map((p) => p.job));
    if (tags.length !== batch.length) throw new Error(`Tag count mismatch: got ${tags.length}, expected ${batch.length}`);
    allTags.push(...tags);
    console.log(`Tagged batch ${Math.floor(i / BATCH_SIZE) + 1}`);
  }

  const transportPeople = filtered
    .map((p, i) => ({ ...p, tags: allTags[i] }))
    .filter((p) => p.tags.includes(FILTER_TAG));

  console.log(`Transport workers: ${transportPeople.length}`);

  const answer = transportPeople.map((p) => ({
    name: p.name,
    surname: p.surname,
    gender: GENDER,
    born: parseInt(p.birthDate.split("-")[0]),
    city: CITY,
    tags: p.tags,
  }));

  console.log("Answer:", JSON.stringify(answer, null, 2));

  const resp = await fetch(HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: process.env.AG3NTS_API_KEY!, task: TASK, answer }),
  });

  console.log("Response:", await resp.json());
}
