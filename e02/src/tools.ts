import type OpenAI from "openai";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = "https://hub.ag3nts.org";

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_power_plants",
      description: "Fetch nuclear power plant codes and GPS coordinates. Call this before anything else.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_suspect_locations",
      description:
        "Fetch GPS coordinates where a suspect was observed. Call for each suspect after get_power_plants. " +
        "After receiving all locations, use calculate_distance to compute km distances to each plant, then identify the single closest suspect before calling get_access_level.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Suspect's first name" },
          surname: { type: "string", description: "Suspect's surname" },
        },
        required: ["name", "surname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_access_level",
      description: "Fetch security access level. Call ONLY ONCE for the single suspect nearest to a power plant. Do not call for others.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          surname: { type: "string" },
          birthYear: { type: "number" },
        },
        required: ["name", "surname", "birthYear"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_distance",
      description:
        "Calculate the great-circle distance in km between two GPS coordinates using the Haversine formula. " +
        "Use this to find which suspect location is closest to which power plant.",
      parameters: {
        type: "object",
        properties: {
          lat1: { type: "number", description: "Latitude of point A" },
          lng1: { type: "number", description: "Longitude of point A" },
          lat2: { type: "number", description: "Latitude of point B" },
          lng2: { type: "number", description: "Longitude of point B" },
        },
        required: ["lat1", "lng1", "lat2", "lng2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the final answer. Call last with all collected data.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          surname: { type: "string" },
          accessLevel: { type: "number" },
          powerPlant: { type: "string", description: "Plant code, format: PWR0000PL" },
        },
        required: ["name", "surname", "accessLevel", "powerPlant"],
      },
    },
  },
];

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeCity(city: string): Promise<{ lat: number; lng: number }> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ", Poland")}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "ai-devs4-exercise" } });
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) throw new Error(`Could not geocode: ${city}`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async get_power_plants() {
    const res = await fetch(`${HUB_URL}/data/${apikey}/findhim_locations.json`);
    const data = (await res.json()) as { power_plants?: Record<string, { is_active: boolean; power: string; code: string }> };
    if (!data.power_plants) throw new Error(`Failed to load power plants: ${JSON.stringify(data)}`);
    return Promise.all(
      Object.entries(data.power_plants).map(async ([city, info]) => {
        const { lat, lng } = await geocodeCity(city);
        return { code: info.code, city, lat, lng };
      })
    );
  },

  async get_suspect_locations({ name, surname }) {
    const res = await fetch(`${HUB_URL}/api/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, name, surname }),
    });
    if (!res.ok) throw new Error(`No locations found for ${name} ${surname} (status ${res.status})`);
    const raw = (await res.json()) as Array<{ lat?: number; lng?: number; latitude?: number; longitude?: number }>;
    return raw.map((c) => ({ lat: c.lat ?? c.latitude!, lng: c.lng ?? c.longitude! }));
  },

  async get_access_level({ name, surname, birthYear }) {
    const res = await fetch(`${HUB_URL}/api/accesslevel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, name, surname, birthYear }),
    });
    const data = (await res.json()) as { accessLevel: number } | { error: string };
    if ("error" in data) throw new Error(data.error);
    console.log(`Access level: ${data.accessLevel}`);
    return data;
  },

  async calculate_distance({ lat1, lng1, lat2, lng2 }) {
    const km = haversine(lat1 as number, lng1 as number, lat2 as number, lng2 as number);
    return { distanceKm: parseFloat(km.toFixed(3)) };
  },

  async submit_answer({ name, surname, accessLevel, powerPlant }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: "findhim", answer: { name, surname, accessLevel, powerPlant } }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return data;
  },
};
