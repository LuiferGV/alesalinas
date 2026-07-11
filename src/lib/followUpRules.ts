import { addMonths, formatDate, addDays } from "./date";

type FollowUpOffset = {
  months?: number;
  days?: number;
};

interface FollowUpRule extends FollowUpOffset {
  type: string;
  note: string;
  keywords: string[];
}

interface AttentionItemLike {
  category: string;
  detail: string;
}

export interface SuggestedFollowUp {
  type: string;
  dueDate: string;
  note: string;
  reason: string;
}

const attentionRules: FollowUpRule[] = [
  {
    type: "Reevaluacion periodontal",
    months: 3,
    note: "Seguimiento sugerido automaticamente por tratamiento periodontal.",
    keywords: ["raspaje", "curetaje", "periodoncia", "periodontal", "mantenimiento periodontal"]
  },
  {
    type: "Mantenimiento 6 meses",
    months: 6,
    note: "Seguimiento sugerido automaticamente por limpieza o mantenimiento.",
    keywords: ["limpieza", "profilaxis", "destartraje", "mantenimiento", "higiene"]
  }
];

const typeOffsets = new Map<string, FollowUpOffset>([
  ["control general", { months: 3 }],
  ["control postquirurgico", { days: 7 }],
  ["retiro de puntos", { days: 7 }],
  ["reevaluacion periodontal", { months: 3 }],
  ["mantenimiento 6 meses", { months: 6 }]
]);

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildDueDate(eventDate: string, offset: FollowUpOffset): string {
  const safeDate = eventDate || new Date().toISOString().slice(0, 10);
  const baseDate = parseIsoDate(safeDate);

  if (offset.months) {
    return addMonths(baseDate, offset.months);
  }

  return addDays(baseDate, offset.days ?? 0);
}

export function getAutoFollowUpDateForType(type: string, eventDate: string): string | null {
  const offset = typeOffsets.get(normalizeText(type));
  if (!offset) return null;
  return buildDueDate(eventDate, offset);
}

export function getSuggestedFollowUpFromAttention(
  items: AttentionItemLike[],
  eventDate: string
): SuggestedFollowUp | null {
  for (const item of items) {
    const haystack = normalizeText(`${item.category} ${item.detail}`);
    const rule = attentionRules.find((candidate) =>
      candidate.keywords.some((keyword) => haystack.includes(keyword))
    );

    if (rule) {
      return {
        type: rule.type,
        dueDate: buildDueDate(eventDate, rule),
        note: rule.note,
        reason: `${rule.type} sugerido para ${item.detail || item.category}`.trim()
      };
    }
  }

  return null;
}

export function getSuggestedFollowUpLabel(type: string, dueDate: string): string {
  return `${type} · ${formatDate(dueDate)}`;
}
