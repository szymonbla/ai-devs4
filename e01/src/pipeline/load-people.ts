import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { CSV_PATH, GENDER, BIRTH_PLACE, BIRTH_YEAR_MIN, BIRTH_YEAR_MAX } from "../constants.js";

export interface Person {
  name: string;
  surname: string;
  gender: string;
  birthDate: string;
  birthPlace: string;
  birthCountry: string;
  job: string;
}

export function loadFilteredPeople(): Person[] {
  const csv = readFileSync(CSV_PATH, "utf-8");
  const records: Person[] = parse(csv, { columns: true, skip_empty_lines: true });
  return records.filter((r) => {
    const year = parseInt(r.birthDate.split("-")[0]);
    return r.gender === GENDER && r.birthPlace === BIRTH_PLACE && year >= BIRTH_YEAR_MIN && year <= BIRTH_YEAR_MAX;
  });
}
