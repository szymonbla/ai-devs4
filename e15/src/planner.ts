import { START_FUEL, START_FOOD } from "./constants.js";

// Universal obstacles (impassable by everyone)
const ALWAYS_BLOCKED = new Set(["t", "r", "m"]);
// Water is passable by walking and horse, but NOT by rocket or car
const WATER = new Set(["w"]);
const VEHICLES_BLOCKED_BY_WATER = new Set(["rocket", "car"]);

interface Vehicle {
  name: string;
  fuel_per_step: number;
  food_per_step: number;
}

interface PlanInput {
  grid: string[][];
  start: [number, number];
  goal: [number, number];
  vehicles: Vehicle[];
  walk_food_per_step: number;
}

interface State {
  x: number;
  y: number;
  fuel: number;
  food: number;
  vehicleIdx: number; // -1 = walking
}

const DIRS: [string, number, number][] = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
];

function stateKey(s: State): string {
  return `${s.x},${s.y},${Math.round(s.fuel * 10)},${Math.round(s.food * 10)},${s.vehicleIdx}`;
}

interface PathResult {
  directions: string[];
  vehicleName: string;
  totalFuel: number;
  totalFood: number;
}

function isCellPassable(cell: string, vehicleName: string): boolean {
  if (ALWAYS_BLOCKED.has(cell)) return false;
  if (WATER.has(cell) && VEHICLES_BLOCKED_BY_WATER.has(vehicleName)) return false;
  return true;
}

function findPath(input: PlanInput, vehicleIdx: number, vehicle: Vehicle): PathResult | null {
  const rows = input.grid.length;
  const cols = input.grid[0].length;
  const [sx, sy] = input.start;
  const [gx, gy] = input.goal;

  const initState: State = {
    x: sx,
    y: sy,
    fuel: START_FUEL,
    food: START_FOOD,
    vehicleIdx,
  };

  const visited = new Set<string>();
  visited.add(stateKey(initState));

  // path entries are direction names, with vehicle switch markers inserted before the direction
  const queue: [State, string[]][] = [[initState, []]];

  while (queue.length > 0) {
    const [cur, path] = queue.shift()!;

    if (cur.x === gx && cur.y === gy) {
      return {
        directions: path,
        vehicleName: vehicle.name,
        totalFuel: START_FUEL - cur.fuel,
        totalFood: START_FOOD - cur.food,
      };
    }

    for (const [dirName, dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;

      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

      const rawCell = input.grid[ny]?.[nx];
      if (!rawCell || rawCell === "") continue;
      const cell = rawCell.toLowerCase();

      // Try moving with current mode (vehicle or walking)
      const modes: number[] = [cur.vehicleIdx];
      if (cur.vehicleIdx >= 0) modes.push(-1); // try switching to walk

      for (const mode of modes) {
        const modeName = mode === -1 ? "walk" : vehicle.name;

        if (!isCellPassable(cell, modeName)) continue;

        let fuelCost: number;
        let foodCost: number;

        if (mode === -1) {
          fuelCost = 0;
          foodCost = input.walk_food_per_step;
        } else {
          fuelCost = vehicle.fuel_per_step;
          foodCost = vehicle.food_per_step;
        }

        const newFuel = cur.fuel - fuelCost;
        const newFood = cur.food - foodCost;

        if (newFuel < 0 || newFood < 0) continue;

        const next: State = {
          x: nx,
          y: ny,
          fuel: newFuel,
          food: newFood,
          vehicleIdx: mode,
        };

        const key = stateKey(next);
        if (visited.has(key)) continue;
        visited.add(key);

        // Insert mode switch marker if switching from vehicle to walk
        const newPath = [...path];
        if (mode === -1 && cur.vehicleIdx >= 0) {
          newPath.push("walk"); // insert vehicle switch marker
        }
        newPath.push(dirName);

        queue.push([next, newPath]);
      }
    }
  }

  return null;
}

export function planRoute(input: PlanInput): { answer: string[]; details: string } {
  input.grid = input.grid
    .map((row) => row.filter((cell) => cell !== "").slice(0, 10))
    .filter((row) => row.length > 0)
    .slice(0, 10);

  console.log(`[planner] grid ${input.grid.length}x${input.grid[0].length}, start=${input.start}, goal=${input.goal}`);
  for (let y = 0; y < input.grid.length; y++) {
    console.log(`[planner]   row ${y}: ${input.grid[y].join(" ")}`)
  }
  console.log(`[planner] vehicles: ${input.vehicles.map((v) => v.name).join(", ")}, walk_food=${input.walk_food_per_step}`);

  let best: PathResult | null = null;

  for (let vi = 0; vi < input.vehicles.length; vi++) {
    const v = input.vehicles[vi];
    console.log(`[planner] trying vehicle: ${v.name} (fuel/step=${v.fuel_per_step}, food/step=${v.food_per_step})`);
    const result = findPath(input, vi, v);
    if (result) {
      console.log(`[planner]   ✓ ${v.name}: ${result.directions.length} steps, fuel=${result.totalFuel.toFixed(1)}, food=${result.totalFood.toFixed(1)}`);
      if (!best || result.directions.length < best.directions.length) {
        best = result;
      }
    } else {
      console.log(`[planner]   ✗ ${v.name}: no path found`);
    }
  }

  // Also try walking only
  const walkOnly = findPath(input, -1, { name: "walk", fuel_per_step: 0, food_per_step: input.walk_food_per_step });
  if (walkOnly) {
    console.log(`[planner]   ✓ walk: ${walkOnly.directions.length} steps, food=${walkOnly.totalFood.toFixed(1)}`);
    if (!best || walkOnly.directions.length < best.directions.length) {
      best = { ...walkOnly, vehicleName: "walk" };
    }
  }

  if (!best) {
    return { answer: [], details: "No feasible path found with any vehicle or walking." };
  }

  const answer = [best.vehicleName, ...best.directions];
  const details = `Best: ${best.vehicleName}, ${best.directions.length} steps, fuel=${best.totalFuel.toFixed(1)}, food=${best.totalFood.toFixed(1)}, path: ${answer.join(",")}`;
  console.log(`[planner] ${details}`);
  return { answer, details };
}
