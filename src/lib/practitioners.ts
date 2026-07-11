import type { FinanceEntry, Patient, Treatment } from "../types/clinic";

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatPractitionerWord(word: string): string {
  if (!word) return "";
  if (/^dr\.?$/i.test(word)) return "Dr.";
  if (/^dra\.?$/i.test(word)) return "Dra.";
  if (/^[a-z]\.$/i.test(word)) return `${word.charAt(0).toUpperCase()}.`;
  if (/^[ivxlcdm]+$/i.test(word)) return word.toUpperCase();

  if (word.includes("-")) {
    return word
      .split("-")
      .map((part) => formatPractitionerWord(part))
      .join("-");
  }

  if (word.includes("'")) {
    return word
      .split("'")
      .map((part) => formatPractitionerWord(part))
      .join("'");
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function hasDoctorTitle(value: string): boolean {
  return /^(Dr\.|Dra\.)\b/.test(value);
}

export function normalizePractitionerName(value: string): string {
  const compact = compactSpaces(value);
  if (!compact) return "";

  const words = compact.split(" ");
  const [firstWord = "", ...restWords] = words;

  const formattedFirstWord = /^doctor\.?$/i.test(firstWord)
    ? "Dr."
    : /^doctora\.?$/i.test(firstWord)
      ? "Dra."
      : formatPractitionerWord(firstWord);

  return [formattedFirstWord, ...restWords.map((word) => formatPractitionerWord(word))]
    .join(" ")
    .trim();
}

export function getPractitionerKey(value: string): string {
  return normalizePractitionerName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^(dr|dra)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getUniquePractitionerNames(values: string[]): string[] {
  const doctors = new Map<string, string>();

  values.forEach((value) => {
    const label = normalizePractitionerName(value);
    const key = getPractitionerKey(label);
    if (!key) return;

    const currentLabel = doctors.get(key);
    if (!currentLabel || (!hasDoctorTitle(currentLabel) && hasDoctorTitle(label))) {
      doctors.set(key, label);
    }
  });

  return [...doctors.values()].sort((left, right) => left.localeCompare(right));
}

function normalizeTreatmentPractitioner(treatment: Treatment): Treatment {
  return {
    ...treatment,
    practitioner: normalizePractitionerName(treatment.practitioner)
  };
}

function normalizeFinancePractitioner(entry: FinanceEntry): FinanceEntry {
  return {
    ...entry,
    practitioner: normalizePractitionerName(entry.practitioner ?? "")
  };
}

export function normalizePatientPractitioners(patient: Patient): Patient {
  return {
    ...patient,
    treatments: patient.treatments.map((treatment) => normalizeTreatmentPractitioner(treatment)),
    finances: patient.finances.map((entry) => normalizeFinancePractitioner(entry))
  };
}
