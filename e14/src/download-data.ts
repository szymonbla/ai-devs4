import "./env.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(import.meta.dirname, "../data");
const BASE_URL = `${process.env.HUB_URL}/dane/s03e04_csv`;

async function main() {
  if (existsSync(DATA_DIR)) {
    console.log("data/ already exists, skipping download");
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });

  // Fetch the index page to discover CSV file names
  const indexRes = await fetch(`${BASE_URL}/`);
  const html = await indexRes.text();

  const csvFiles = [...html.matchAll(/href="([^"]+\.csv)"/g)].map((m) => m[1]);

  if (csvFiles.length === 0) {
    console.log("No CSV links found. Index page content:");
    console.log(html.slice(0, 2000));
    return;
  }

  console.log(`Found ${csvFiles.length} CSV file(s): ${csvFiles.join(", ")}`);

  for (const file of csvFiles) {
    const url = `${BASE_URL}/${file}`;
    console.log(`Downloading ${url}...`);
    const res = await fetch(url);
    const text = await res.text();
    writeFileSync(resolve(DATA_DIR, file), text);
    console.log(`  → saved ${file} (${text.length} bytes)`);
  }

  console.log("Done.");
}

main().catch(console.error);
