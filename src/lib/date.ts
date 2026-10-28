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

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Converts the date shapes used by current and historical records to a local
 * calendar key. No timezone conversion is performed, so a stored day cannot
 * move to the previous/next month while calculating financial periods.
 */
export function normalizeIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toIsoDate(value);
  }

  if (typeof value !== "string") return null;

  const rawValue = value.trim();
  if (!rawValue) return null;

  // ISO dates (including timestamps), unpadded legacy dates and YYYY/MM/DD.
  const yearFirstMatch = rawValue.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:$|[T\s])/);
  if (yearFirstMatch) {
    const year = Number(yearFirstMatch[1]);
    const month = Number(yearFirstMatch[2]);
    const day = Number(yearFirstMatch[3] ?? 1);
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Older exports commonly used the Paraguayan DD/MM/YYYY representation.
  const dayFirstMatch = rawValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = Number(dayFirstMatch[2]);
    const year = Number(dayFirstMatch[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function parseLocalDate(value: unknown): Date | null {
  const normalizedDate = normalizeIsoDate(value);
  if (!normalizedDate) return null;

  const [year, month, day] = normalizedDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayIsoDate(referenceDate = new Date()): string {
  return toIsoDate(referenceDate);
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
  const date = parseLocalDate(value);
  return date ? shortDateFormatter.format(date) : "Sin registro";
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

function normalizeMonthKey(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function isSameMonth(isoDate: string, monthKey: string): boolean {
  const normalizedDate = normalizeIsoDate(isoDate);
  const normalizedMonth = normalizeMonthKey(monthKey);
  return Boolean(normalizedDate && normalizedMonth && normalizedDate.slice(0, 7) === normalizedMonth);
}

export function shiftMonthKey(monthKey: string, amount: number): string {
  const baseDate = monthKeyToDate(monthKey);
  const shiftedDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + amount, 1);
  return getMonthKey(shiftedDate);
}

export function normalizeMonthRange(startMonth: string, endMonth: string): MonthRange {
  const normalizedStart = normalizeMonthKey(startMonth) ?? startMonth;
  const normalizedEnd = normalizeMonthKey(endMonth) ?? endMonth;

  return compareMonthKeys(normalizedStart, normalizedEnd) <= 0
    ? { startMonth: normalizedStart, endMonth: normalizedEnd }
    : { startMonth: normalizedEnd, endMonth: normalizedStart };
}

export function isDateWithinMonthRange(dateValue: unknown, range: MonthRange): boolean {
  const normalizedDate = normalizeIsoDate(dateValue);
  const startMonth = normalizeMonthKey(range.startMonth);
  const endMonth = normalizeMonthKey(range.endMonth);
  if (!normalizedDate || !startMonth || !endMonth) return false;

  const normalizedRange = normalizeMonthRange(startMonth, endMonth);
  const targetMonth = normalizedDate.slice(0, 7);
  return (
    compareMonthKeys(targetMonth, normalizedRange.startMonth) >= 0 &&
    compareMonthKeys(targetMonth, normalizedRange.endMonth) <= 0
  );
}

export function getDaysDiff(isoDate: string, now = new Date()): number {
  const target = parseLocalDate(isoDate);
  if (!target) return Number.NaN;
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

export function normalizeParaguayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("595")) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length >= 10) {
    return `+595${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `+595${digits}`;
  }

  return phone.trim().startsWith("+") ? phone.trim() : `+${digits}`;
}

export function getParaguayPhoneSearchTerms(phone: string): string[] {
  const rawValue = phone.trim().toLowerCase();
  const normalized = normalizeParaguayPhone(phone).toLowerCase();
  const digits = normalized.replace(/\D/g, "");
  const localDigits = digits.startsWith("595") ? `0${digits.slice(3)}` : digits;

  return Array.from(new Set([rawValue, normalized, digits, localDigits].filter(Boolean)));
}

export function buildWhatsAppLink(phone: string): string {
  const digits = normalizeParaguayPhone(phone).replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}
