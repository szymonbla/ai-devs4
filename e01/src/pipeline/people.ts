import OpenAI from "openai";
import { jobTagsSchema } from "../schemas/job-tags.js";
import { jobTaggerSystemPrompt } from "../prompts/job-tagger.js";
import { OPENROUTER_BASE_URL, MODEL } from "../constants.js";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: OPENROUTER_BASE_URL,
});

type IndexedJob = { i: number; job: string };
type IndexedResult = { i: number; tags: string[] };

export async function callModel(jobs: IndexedJob[]): Promise<IndexedResult[]> {
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

