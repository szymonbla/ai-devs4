import OpenAI from "openai";
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { VISION_MODEL } from "./constants.js";

const DARK = 100;
const CELL_SIZE = 300;

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const POSITIONS = ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] as const;

const TARGET_CELLS_DIR = resolve(import.meta.dirname, "../data/target-cells");
const SOLVED_IMG = resolve(import.meta.dirname, "../data/solved-electricity.png");

const COMPARE_PROMPT = `Image 1 is the TARGET. Image 2 is the CURRENT state.
Both show the same pipe piece, possibly rotated (90° clockwise increments).
How many 90° clockwise rotations to go from CURRENT to TARGET?
Answer: single digit 0-3, nothing else.`;

// --- Grid detection ---

function groupLines(positions: number[]): number[] {
  if (!positions.length) return [];
  positions.sort((a, b) => a - b);
  const groups: number[][] = [[positions[0]]];
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - positions[i - 1] <= 5) groups[groups.length - 1].push(positions[i]);
    else groups.push([positions[i]]);
  }
  return groups.map((g) => Math.round(g.reduce((a, b) => a + b) / g.length));
}

async function detectGridLines(imgBuffer: Buffer): Promise<{ hLines: number[]; vLines: number[] }> {
  const { data, info } = await sharp(imgBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = (x: number, y: number) => data[y * width + x];

  const hCandidates: number[] = [];
  for (let y = 0; y < height; y++) {
    let stretch = 0, maxStretch = 0;
    for (let x = 0; x < width; x++) {
      if (px(x, y) < DARK) { stretch++; maxStretch = Math.max(maxStretch, stretch); }
      else stretch = 0;
    }
    if (maxStretch > width * 0.2) hCandidates.push(y);
  }

  const vCandidates: number[] = [];
  for (let x = 0; x < width; x++) {
    let stretch = 0, maxStretch = 0;
    for (let y = 0; y < height; y++) {
      if (px(x, y) < DARK) { stretch++; maxStretch = Math.max(maxStretch, stretch); }
      else stretch = 0;
    }
    if (maxStretch > height * 0.5) vCandidates.push(x);
  }

  return { hLines: groupLines(hCandidates), vLines: groupLines(vCandidates) };
}

async function splitGrid(imgBuffer: Buffer): Promise<Map<string, Buffer>> {
  const { hLines, vLines } = await detectGridLines(imgBuffer);
  if (hLines.length !== 4 || vLines.length !== 4) {
    throw new Error(`Grid detection failed: ${hLines.length}H x ${vLines.length}V (need 4x4)`);
  }

  const cells = new Map<string, Buffer>();

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const pos = `${row + 1}x${col + 1}`;
      const rawW = vLines[col + 1] - vLines[col];
      const rawH = hLines[row + 1] - hLines[row];
      const padX = Math.round(rawW * 0.05); // 5% margin to remove grid lines
      const padY = Math.round(rawH * 0.05);
      const left = vLines[col] + padX;
      const top = hLines[row] + padY;
      const w = rawW - padX * 2;
      const h = rawH - padY * 2;

      const buf = await sharp(imgBuffer)
        .extract({ left, top, width: w, height: h })
        .resize(CELL_SIZE, CELL_SIZE, { fit: "fill" })
        .normalise() // enhance contrast
        .png()
        .toBuffer();
      cells.set(pos, buf);
    }
  }
  return cells;
}

// --- Target cell caching ---

async function ensureTargetCells(): Promise<Map<string, Buffer>> {
  const cells = new Map<string, Buffer>();
  const firstCell = resolve(TARGET_CELLS_DIR, "1x1.png");

  if (existsSync(firstCell)) {
    for (const pos of POSITIONS) {
      cells.set(pos, readFileSync(resolve(TARGET_CELLS_DIR, `${pos}.png`)));
    }
    return cells;
  }

  console.log("   [vision] extracting target cells from solved image...");
  mkdirSync(TARGET_CELLS_DIR, { recursive: true });
  const imgBuffer = readFileSync(SOLVED_IMG);
  const extracted = await splitGrid(imgBuffer);

  for (const [pos, buf] of extracted) {
    writeFileSync(resolve(TARGET_CELLS_DIR, `${pos}.png`), buf);
    cells.set(pos, buf);
  }
  return cells;
}

// --- Comparison ---

async function compareCellRotation(targetCell: Buffer, currentCell: Buffer): Promise<number> {
  const targetB64 = targetCell.toString("base64");
  const currentB64 = currentCell.toString("base64");

  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: COMPARE_PROMPT },
          { type: "image_url", image_url: { url: `data:image/png;base64,${targetB64}` } },
          { type: "image_url", image_url: { url: `data:image/png;base64,${currentB64}` } },
        ],
      },
    ],
  });

  const content = response.choices[0].message.content!.trim();
  const match = content.match(/[0-3]/);
  if (!match) throw new Error(`Failed to parse rotation: ${content}`);
  return parseInt(match[0]);
}

// --- Public API ---

export async function getRotationsNeeded(boardImgBase64: string): Promise<Record<string, number>> {
  const targetCells = await ensureTargetCells();
  const boardBuffer = Buffer.from(boardImgBase64, "base64");
  const currentCells = await splitGrid(boardBuffer);

  const entries = await Promise.all(
    POSITIONS.map(async (pos) => {
      const rotations = await compareCellRotation(targetCells.get(pos)!, currentCells.get(pos)!);
      console.log(`   [compare] ${pos}: ${rotations} rotation(s) needed`);
      return [pos, rotations] as const;
    })
  );

  const result: Record<string, number> = {};
  for (const [pos, r] of entries) {
    result[pos] = r;
  }
  return result;
}
