import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import OpenAI from "openai";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const AG3NTS_API_KEY = process.env.AG3NTS_API_KEY!;

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

interface Person {
  name: string;
  surname: string;
  gender: string;
  birthDate: string;
  birthPlace: string;
  birthCountry: string;
  job: string;
}

async function tagJobs(jobs: string[]): Promise<string[][]> {
  const resp = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a job tagger. For each job description, assign one or more tags from this list:
["IT", "transport", "edukacja", "medycyna", "praca z ludźmi", "praca z pojazdami", "praca fizyczna"]
Return a JSON object with a single key "results" which is an array of arrays of tags, one inner array per job description, in the same order as input.`,
      },
      {
        role: "user",
        content: JSON.stringify(jobs),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "job_tags",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "IT",
                    "transport",
                    "edukacja",
                    "medycyna",
                    "praca z ludźmi",
                    "praca z pojazdami",
                    "praca fizyczna",
                  ],
                },
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = resp.choices[0].message.content!;
  const parsed = JSON.parse(content) as { results: string[][] };
  return parsed.results;
}

async function main() {
  // Load CSV
  const csv = readFileSync("data/people.csv", "utf-8");
  const records: Person[] = parse(csv, { columns: true, skip_empty_lines: true });

  // Filter: male, born in Grudziądz, age 20-40 (birth year 1986-2006)
  const filtered = records.filter((r) => {
    const year = parseInt(r.birthDate.split("-")[0]);
    return r.gender === "M" && r.birthPlace === "Grudziądz" && year >= 1986 && year <= 2006;
  });

  console.log(`Filtered: ${filtered.length} people`);

  // Tag jobs in batches of 20
  const batchSize = 20;
  const allTags: string[][] = [];
  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    const tags = await tagJobs(batch.map((p) => p.job));
    allTags.push(...tags);
    console.log(`Tagged batch ${Math.floor(i / batchSize) + 1}`);
  }

  // Filter for transport tag
  const transportPeople = filtered
    .map((p, i) => ({ ...p, tags: allTags[i] }))
    .filter((p) => p.tags.includes("transport"));

  console.log(`Transport workers: ${transportPeople.length}`);

  // Build answer
  const answer = transportPeople.map((p) => ({
    name: p.name,
    surname: p.surname,
    gender: "M",
    born: parseInt(p.birthDate.split("-")[0]),
    city: "Grudziądz",
    tags: p.tags,
  }));

  console.log("Answer:", JSON.stringify(answer, null, 2));

  // Submit
  const resp = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: AG3NTS_API_KEY,
      task: "people",
      answer,
    }),
  });

  const result = await resp.json();
  console.log("Response:", result);
}

main().catch(console.error);
