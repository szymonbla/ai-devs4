import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JOB_TAGS } from "../schemas/job-tags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrompt(file: string, vars: Record<string, string>): string {
  const raw = readFileSync(join(__dirname, file), "utf-8");
  const body = raw.replace(/^---[\s\S]*?---\n/, "");
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, v),
    body
  );
}

export const jobTaggerSystemPrompt = loadPrompt("job-tagger.md", {
  tags: [...JOB_TAGS].map((t) => `- ${t}`).join("\n"),
});
