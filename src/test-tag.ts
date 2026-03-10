import { tagJobs } from "./pipeline/people.js";
import { loadFilteredPeople } from "./pipeline/load-people.js";

async function main() {
  const filtered = loadFilteredPeople();
  const sampleJobs = filtered.slice(0, 5).map((p) => p.job);
  console.log("Testing with", sampleJobs.length, "jobs");
  const tags = await tagJobs(sampleJobs);
  console.log("Tags:", JSON.stringify(tags, null, 2));
  console.log("Counts match:", tags.length === sampleJobs.length);
}

main().catch(console.error);
