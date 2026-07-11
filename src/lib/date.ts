const currencyFormatter = new Intl.NumberFormat("es-PY");
const shortDateFormatter = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});
const monthLabelFormatter = new Intl.DateTimeFormat("es-PY", {
  month: "long",
  year: "numeric"
});
const shortMonthFormatter = new Intl.DateTimeFormat("es-PY", {
  month: "short"
});
const shortMonthYearFormatter = new Intl.DateTimeFormat("es-PY", {
  month: "short",
  year: "numeric"
});

export interface MonthRange {
  startMonth: string;
  endMonth: string;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(baseDate: Date, amount: number): string {
  const next = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  next.setDate(next.getDate() + amount);
  return toIsoDate(next);
}

export function addMonths(baseDate: Date, amount: number): string {
  const next = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  next.setMonth(next.getMonth() + amount);
  return toIsoDate(next);
}

export function formatDate(value: string | null): string {
  if (!value) return "Sin registro";
  return shortDateFormatter.format(parseLocalDate(value));
}

export function formatGs(amount: number): string {
  return `Gs. ${currencyFormatter.format(Math.round(amount || 0))}`;
}

export function getMonthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyToDate(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function compareMonthKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

export function isSameMonth(isoDate: string, monthKey: string): boolean {
  return isoDate.slice(0, 7) === monthKey;
}

export function shiftMonthKey(monthKey: string, amount: number): string {
  const baseDate = monthKeyToDate(monthKey);
  const shiftedDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + amount, 1);
  return getMonthKey(shiftedDate);
}

export function normalizeMonthRange(startMonth: string, endMonth: string): MonthRange {
  return compareMonthKeys(startMonth, endMonth) <= 0
    ? { startMonth, endMonth }
    : { startMonth: endMonth, endMonth: startMonth };
}

export function isDateWithinMonthRange(isoDate: string, range: MonthRange): boolean {
  const targetMonth = isoDate.slice(0, 7);
  return compareMonthKeys(targetMonth, range.startMonth) >= 0 && compareMonthKeys(targetMonth, range.endMonth) <= 0;
}

export function getDaysDiff(isoDate: string, now = new Date()): number {
  const target = parseLocalDate(isoDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / 86400000);
}

export function formatMonthLabel(monthKey: string): string {
  return monthLabelFormatter.format(monthKeyToDate(monthKey));
}

export function formatMonthRangeLabel(range: MonthRange): string {
  if (range.startMonth === range.endMonth) {
    return formatMonthLabel(range.startMonth);
  }

  const startDate = monthKeyToDate(range.startMonth);
  const endDate = monthKeyToDate(range.endMonth);
  const sameYear = range.startMonth.slice(0, 4) === range.endMonth.slice(0, 4);

  if (sameYear) {
    return `${shortMonthFormatter.format(startDate)} - ${monthLabelFormatter.format(endDate)}`;
  }

  return `${shortMonthYearFormatter.format(startDate)} - ${shortMonthYearFormatter.format(endDate)}`;
}

export function buildWhatsAppLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}
