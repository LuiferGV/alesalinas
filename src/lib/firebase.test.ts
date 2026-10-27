import { describe, expect, it } from "vitest";
import { normalizeFirebaseCollection, normalizeStoredAmount } from "./firebase";

describe("Firebase legacy data normalization", () => {
  it("lee montos numericos y montos formateados sin contaminar los totales", () => {
    expect(normalizeStoredAmount(1_000_000)).toBe(1_000_000);
    expect(normalizeStoredAmount("Gs. 1.000.000")).toBe(1_000_000);
    expect(normalizeStoredAmount("1,000,000")).toBe(1_000_000);
    expect(normalizeStoredAmount("1.234,50")).toBe(1_234.5);
    expect(normalizeStoredAmount("dato invalido")).toBe(0);
    expect(normalizeStoredAmount(-50_000)).toBe(0);
  });

  it("usa la clave Firebase para registros de mapa aunque el id interno este repetido", () => {
    const items = normalizeFirebaseCollection<{ id: string; value: number }>({
      "firebase-a": { id: "duplicado", value: 1 },
      "firebase-b": { id: "duplicado", value: 2 }
    });

    expect(items).toEqual([
      { id: "firebase-a", value: 1 },
      { id: "firebase-b", value: 2 }
    ]);
  });

  it("conserva todos los elementos de arrays y vuelve unicos los ids repetidos", () => {
    const items = normalizeFirebaseCollection<{ id: string; value: number }>(
      [
        { id: "item", value: 1 },
        { id: "item", value: 2 },
        { value: 3 }
      ],
      "fallback"
    );

    expect(items).toEqual([
      { id: "item", value: 1 },
      { id: "item-2", value: 2 },
      { id: "fallback-3", value: 3 }
    ]);
  });
});
