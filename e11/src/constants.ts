export const TASK = "evaluation";
export const MODEL = "openai/gpt-4o-mini";
export const CLASSIFY_MODEL = "anthropic/claude-sonnet-4-6";
export const DATA_URL = "REDACTED_URL";

export const SENSOR_FIELD_MAP: Record<string, { field: string; min: number; max: number }> = {
  temperature: { field: "temperature_K", min: 553, max: 873 },
  pressure: { field: "pressure_bar", min: 60, max: 160 },
  water: { field: "water_level_meters", min: 5.0, max: 15.0 },
  voltage: { field: "voltage_supply_v", min: 229.0, max: 231.0 },
  humidity: { field: "humidity_percent", min: 40.0, max: 80.0 },
};

export const ALL_MEASUREMENT_FIELDS = Object.values(SENSOR_FIELD_MAP).map((s) => s.field);
