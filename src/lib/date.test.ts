import { describe, expect, it } from "vitest";
import { getTodayIsoDate } from "./date";

describe("local date keys", () => {
  it("conserva el dia calendario local incluso al final de la noche", () => {
    const localLateNight = new Date(2026, 8, 30, 23, 30, 0);

    expect(getTodayIsoDate(localLateNight)).toBe("2026-09-30");
  });
});
