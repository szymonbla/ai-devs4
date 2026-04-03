import { readFileSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(import.meta.dirname, "../data");

function parseCSV(filename: string): string[][] {
  const text = readFileSync(resolve(DATA_DIR, filename), "utf-8");
  return text.trim().split("\n").map((line) => line.split(","));
}

// cities.csv: name,code
const citiesRows = parseCSV("cities.csv").slice(1);
const codeToCity = new Map(citiesRows.map(([name, code]) => [code, name]));

// items.csv: name,code
const itemsRows = parseCSV("items.csv").slice(1);
const itemNameToCode = new Map(itemsRows.map(([name, code]) => [name, code]));

// connections.csv: itemCode,cityCode
const connectionsRows = parseCSV("connections.csv").slice(1);
const itemCodeToCityCodes = new Map<string, string[]>();
for (const [itemCode, cityCode] of connectionsRows) {
  if (!itemCodeToCityCodes.has(itemCode)) itemCodeToCityCodes.set(itemCode, []);
  itemCodeToCityCodes.get(itemCode)!.push(cityCode);
}

export const allItemNames = itemsRows.map(([name]) => name);

export function getCitiesForItem(itemName: string): string[] {
  const code = itemNameToCode.get(itemName);
  if (!code) return [];
  const cityCodes = itemCodeToCityCodes.get(code) ?? [];
  return cityCodes.map((cc) => codeToCity.get(cc)).filter(Boolean) as string[];
}

console.log(`[data] ${citiesRows.length} cities, ${itemsRows.length} items, ${connectionsRows.length} connections`);
