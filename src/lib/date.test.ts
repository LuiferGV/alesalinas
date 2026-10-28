import { describe, expect, it } from "vitest";
import {
  getTodayIsoDate,
  isDateWithinMonthRange,
  normalizeIsoDate,
  normalizeMonthRange
} from "./date";

describe("local date keys", () => {
  it("conserva el dia calendario local incluso al final de la noche", () => {
    const localLateNight = new Date(2026, 8, 30, 23, 30, 0);

    expect(getTodayIsoDate(localLateNight)).toBe("2026-09-30");
  });

  it("normaliza fechas historicas sin cambiar el mes calendario", () => {
    expect(normalizeIsoDate("2026-9-3")).toBe("2026-09-03");
    expect(normalizeIsoDate("03/09/2026")).toBe("2026-09-03");
    expect(normalizeIsoDate("2026-09-30T23:59:59.000Z")).toBe("2026-09-30");
    expect(normalizeIsoDate("2026-02-30")).toBeNull();
    expect(normalizeIsoDate("sin-fecha")).toBeNull();
  });

  it("incluye ambos limites del rango y acepta los meses invertidos", () => {
    const reversedRange = normalizeMonthRange("2026-10", "2026-08");

    expect(reversedRange).toEqual({ startMonth: "2026-08", endMonth: "2026-10" });
    expect(isDateWithinMonthRange("2026-08-01", reversedRange)).toBe(true);
    expect(isDateWithinMonthRange("31/10/2026", reversedRange)).toBe(true);
    expect(isDateWithinMonthRange("2026-11-01", reversedRange)).toBe(false);
    expect(isDateWithinMonthRange("fecha-invalida", reversedRange)).toBe(false);
  });
});
