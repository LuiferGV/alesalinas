import { describe, expect, it } from "vitest";
import { getDashboardMetrics } from "./dashboard";
import {
  normalizeFirebaseCollection,
  normalizePatient,
  normalizeStoredAmount,
  normalizeStoredDate
} from "./firebase";

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

  it("normaliza fechas historicas y rechaza fechas imposibles", () => {
    expect(normalizeStoredDate("2026-09-07T18:30:00.000Z")).toBe("2026-09-07");
    expect(normalizeStoredDate("2026/9/7")).toBe("2026-09-07");
    expect(normalizeStoredDate("7/9/2026")).toBe("2026-09-07");
    expect(normalizeStoredDate("31/02/2026", "2026-08-15")).toBe("2026-08-15");
    expect(normalizeStoredDate("fecha invalida", "15/08/2026")).toBe("2026-08-15");
  });

  it("toma los pagos explicitos como autoridad aunque paidAmount historico este desactualizado", () => {
    const patient = normalizePatient("patient-1", {
      fullName: "Paciente historico",
      createdAt: "2026-08-01",
      finances: {
        "finance-mixed": {
          fecha: "15/09/2026",
          concept: "Tratamiento mixto",
          totalAmount: "Gs. 1.000.000",
          paidAmount: "Gs. 700.000",
          payments: {
            "payment-october": {
              paidAt: "2026-10-02T10:00:00.000Z",
              amount: "300.000",
              method: "Efectivo"
            }
          }
        },
        "finance-already-reconciled": {
          date: "2026-09-20",
          concept: "Sin duplicar",
          totalAmount: 200_000,
          paidAmount: 200_000,
          payments: [{ id: "payment-complete", date: "20/09/2026", amount: 200_000 }]
        },
        "finance-explicit-wins": {
          date: "2026-09-21",
          concept: "Pagos detallados completos",
          totalAmount: 300_000,
          paidAmount: 100_000,
          payments: [{ id: "payment-larger", date: "21/09/2026", amount: 300_000 }]
        }
      }
    });

    const mixed = patient.finances.find((entry) => entry.id === "finance-mixed");
    const reconciled = patient.finances.find((entry) => entry.id === "finance-already-reconciled");
    const explicitWins = patient.finances.find((entry) => entry.id === "finance-explicit-wins");

    expect(mixed).toMatchObject({ date: "2026-09-15", paidAmount: 300_000, pendingAmount: 700_000 });
    expect(mixed?.payments).toEqual([
      expect.objectContaining({ id: "payment-october", date: "2026-10-02", amount: 300_000 })
    ]);
    expect(reconciled?.payments).toHaveLength(1);
    expect(reconciled?.paidAmount).toBe(200_000);
    expect(explicitWins?.payments).toHaveLength(1);
    expect(explicitWins?.paidAmount).toBe(300_000);

    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" }).incomeAmount
    ).toBe(500_000);
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-10", endMonth: "2026-10" }).incomeAmount
    ).toBe(300_000);
  });

  it("solo infiere un pago desde total menos pendiente cuando el pendiente estaba guardado", () => {
    const patient = normalizePatient("patient-payment-fallbacks", {
      createdAt: "2026-09-01",
      finances: {
        inferred: {
          date: "2026-09-10",
          totalAmount: 1_000_000,
          pendingAmount: 300_000
        },
        noEvidence: {
          date: "2026-09-11",
          totalAmount: 800_000
        },
        explicitZero: {
          date: "2026-09-12",
          totalAmount: 900_000,
          paidAmount: 0,
          pendingAmount: 100_000
        },
        invalidPending: {
          date: "2026-09-13",
          totalAmount: 600_000,
          pendingAmount: "NaN"
        },
        negativePending: {
          date: "2026-09-14",
          totalAmount: 500_000,
          pendingAmount: -100_000
        },
        excessivePending: {
          date: "2026-09-15",
          totalAmount: 400_000,
          pendingAmount: 700_000
        }
      }
    });

    const inferred = patient.finances.find((entry) => entry.id === "inferred");
    const noEvidence = patient.finances.find((entry) => entry.id === "noEvidence");
    const explicitZero = patient.finances.find((entry) => entry.id === "explicitZero");
    const invalidPending = patient.finances.find((entry) => entry.id === "invalidPending");
    const negativePending = patient.finances.find((entry) => entry.id === "negativePending");
    const excessivePending = patient.finances.find((entry) => entry.id === "excessivePending");

    expect(inferred).toMatchObject({ paidAmount: 700_000, pendingAmount: 300_000 });
    expect(inferred?.payments).toEqual([
      expect.objectContaining({ amount: 700_000, method: "Importado", date: "2026-09-10" })
    ]);
    expect(noEvidence).toMatchObject({ paidAmount: 0, pendingAmount: 800_000, payments: [] });
    expect(explicitZero).toMatchObject({ paidAmount: 0, pendingAmount: 900_000, payments: [] });
    expect(invalidPending).toMatchObject({ paidAmount: 0, pendingAmount: 600_000, payments: [] });
    expect(negativePending).toMatchObject({ paidAmount: 0, pendingAmount: 500_000, payments: [] });
    expect(excessivePending).toMatchObject({ paidAmount: 0, pendingAmount: 400_000, payments: [] });
  });

  it("suma egresos actuales y legacy aunque ambas colecciones coexistan", () => {
    const patient = normalizePatient("patient-2", {
      fullName: "Paciente con egresos mixtos",
      lastVisit: "2026-09-01",
      patientExpenses: {
        shared: {
          fecha: "05/09/2026",
          concept: "Material actual",
          amount: "100.000"
        }
      },
      expenses: {
        shared: {
          createdAt: "2026/09/06",
          concept: "Material historico con id repetido",
          amount: "200.000"
        },
        legacy: {
          date: "fecha invalida",
          concept: "Material historico sin fecha valida",
          amount: "50.000"
        }
      }
    });

    expect(patient.patientExpenses).toHaveLength(3);
    expect(patient.patientExpenses.map((expense) => expense.id)).toEqual(["shared", "shared-2", "legacy"]);
    expect(patient.patientExpenses.map((expense) => expense.date)).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-01"
    ]);
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" }).expensesAmount
    ).toBe(350_000);
  });

  it("no duplica un egreso que esta espejado en las colecciones actual y legacy", () => {
    const patient = normalizePatient("patient-expense-copy", {
      createdAt: "2026-09-01",
      patientExpenses: {
        expense: {
          date: "2026-09-10",
          concept: "Laboratorio",
          category: "Laboratorio",
          amount: "500.000",
          description: "Corona"
        }
      },
      expenses: {
        expense: {
          fecha: "10/09/2026",
          concept: "Laboratorio",
          category: "Laboratorio",
          amount: 500_000,
          description: "Corona"
        }
      }
    });

    expect(patient.patientExpenses).toHaveLength(1);
    expect(patient.patientExpenses[0]).toMatchObject({ id: "expense", amount: 500_000 });
  });

  it("conserva egresos distintos aunque compartan id o todos los demas datos", () => {
    const patient = normalizePatient("patient-real-duplicates", {
      createdAt: "2026-09-01",
      patientExpenses: {
        shared: { date: "2026-09-10", concept: "Laboratorio", amount: 100_000 },
        current: { date: "2026-09-11", concept: "Insumo", amount: 50_000 }
      },
      expenses: {
        shared: { date: "2026-09-10", concept: "Laboratorio", amount: 200_000 },
        legacy: { date: "2026-09-11", concept: "Insumo", amount: 50_000 }
      }
    });

    expect(patient.patientExpenses.map((expense) => expense.id)).toEqual([
      "shared",
      "current",
      "shared-2",
      "legacy"
    ]);
    expect(patient.patientExpenses.reduce((sum, expense) => sum + expense.amount, 0)).toBe(400_000);
  });

  it("usa la fecha del tratamiento vinculado y no mueve registros totalmente sin fecha al mes actual", () => {
    const patient = normalizePatient("patient-dates", {
      treatments: {
        treatment: { date: "2026-09-12", detail: "Corona" }
      },
      finances: {
        linked: {
          linkedTreatmentId: "treatment",
          totalAmount: 300_000,
          paidAmount: 300_000
        },
        undated: {
          totalAmount: 100_000,
          paidAmount: 100_000
        }
      },
      patientExpenses: {
        linked: { linkedTreatmentId: "treatment", concept: "Laboratorio", amount: 80_000 },
        undated: { concept: "Sin fecha", amount: 20_000 }
      }
    });

    expect(patient.finances.find((entry) => entry.id === "linked")?.date).toBe("2026-09-12");
    expect(patient.patientExpenses.find((entry) => entry.id === "linked")?.date).toBe("2026-09-12");
    expect(patient.finances.find((entry) => entry.id === "undated")?.date).toBe("");
    expect(patient.patientExpenses.find((entry) => entry.id === "undated")?.date).toBe("");
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" })
    ).toMatchObject({ incomeAmount: 300_000, expensesAmount: 80_000 });
  });

  it("recupera la fecha financiera desde el vinculo inverso del tratamiento", () => {
    const patient = normalizePatient("patient-reverse-link", {
      createdAt: "2026-08-01",
      treatments: {
        treatment: {
          date: "2026-09-18",
          detail: "Corona",
          linkedFinanceId: "finance"
        }
      },
      finances: {
        finance: {
          concept: "Corona",
          totalAmount: 450_000,
          paidAmount: 450_000
        }
      }
    });

    expect(patient.finances.find((entry) => entry.id === "finance")?.date).toBe("2026-09-18");
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" }).incomeAmount
    ).toBe(450_000);
  });

  it("repara historicamente fechas vinculadas sin mover cobros manuales", () => {
    const patient = normalizePatient("patient-historical-date-repair", {
      createdAt: "2026-08-01",
      treatments: {
        "treatment-reverse": {
          date: "2026-09-12",
          detail: "Corona",
          linkedFinanceId: "finance-reverse"
        },
        "treatment-direct": {
          date: "2026-09-13",
          detail: "Implante"
        }
      },
      finances: {
        "finance-reverse": {
          date: "2026-10-02",
          concept: "Corona",
          totalAmount: 500_000,
          payments: [
            {
              id: "initial-payment",
              date: "2026-10-02",
              amount: 400_000,
              method: "Efectivo",
              note: "Pago registrado junto con la atencion."
            },
            {
              id: "manual-payment",
              date: "2026-10-02",
              amount: 100_000,
              method: "Efectivo",
              note: "Fecha corregida manualmente"
            }
          ]
        },
        "finance-direct": {
          date: "2026-10-03",
          linkedTreatmentId: "treatment-direct",
          concept: "Implante",
          totalAmount: 200_000,
          payments: [
            {
              id: "finance-direct-legacy-payment",
              date: "2026-10-03",
              amount: 200_000,
              method: "Importado",
              note: "Pago importado desde un registro anterior."
            }
          ]
        }
      },
      patientExpenses: {
        "expense-reverse": {
          date: "2026-10-02",
          linkedTreatmentId: "treatment-reverse",
          concept: "Laboratorio",
          amount: 80_000
        },
        "expense-direct": {
          date: "2026-10-03",
          linkedTreatmentId: "treatment-direct",
          concept: "Insumos",
          amount: 20_000
        }
      }
    });

    const reverseFinance = patient.finances.find((entry) => entry.id === "finance-reverse");
    const directFinance = patient.finances.find((entry) => entry.id === "finance-direct");

    expect(reverseFinance).toMatchObject({
      linkedTreatmentId: "treatment-reverse",
      date: "2026-09-12"
    });
    expect(reverseFinance?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "initial-payment", date: "2026-09-12" }),
        expect.objectContaining({ id: "manual-payment", date: "2026-10-02" })
      ])
    );
    expect(directFinance).toMatchObject({
      linkedTreatmentId: "treatment-direct",
      date: "2026-09-13"
    });
    expect(directFinance?.payments).toEqual([
      expect.objectContaining({ id: "finance-direct-legacy-payment", date: "2026-09-13" })
    ]);
    expect(patient.patientExpenses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "expense-reverse", date: "2026-09-12" }),
        expect.objectContaining({ id: "expense-direct", date: "2026-09-13" })
      ])
    );

    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" })
    ).toMatchObject({ incomeAmount: 600_000, expensesAmount: 100_000, netAmount: 500_000 });
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-10", endMonth: "2026-10" })
    ).toMatchObject({ incomeAmount: 100_000, expensesAmount: 0, netAmount: 100_000 });
  });

  it("repara el pago inicial aunque el cargo ya tenga la fecha corregida", () => {
    const patient = normalizePatient("patient-already-corrected-finance", {
      treatments: {
        treatment: {
          date: "2026-09-20",
          detail: "Corona",
          linkedFinanceId: "finance"
        }
      },
      finances: {
        finance: {
          date: "2026-09-20",
          concept: "Corona",
          totalAmount: 600_000,
          payments: [
            {
              id: "initial-payment",
              date: "2026-10-02",
              amount: 400_000,
              method: "Efectivo",
              note: "Pago registrado junto con la atencion."
            },
            {
              id: "manual-without-date",
              amount: 100_000,
              method: "Transferencia",
              note: "Pago sin fecha importado"
            },
            {
              id: "manual-october",
              date: "2026-10-05",
              amount: 100_000,
              method: "Transferencia",
              note: "Pago posterior"
            }
          ]
        }
      }
    });

    const finance = patient.finances.find((entry) => entry.id === "finance");
    expect(finance?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "initial-payment", date: "2026-09-20" }),
        expect.objectContaining({ id: "manual-without-date", date: "2026-09-20" }),
        expect.objectContaining({ id: "manual-october", date: "2026-10-05" })
      ])
    );
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-09", endMonth: "2026-09" }).incomeAmount
    ).toBe(500_000);
    expect(
      getDashboardMetrics([patient], [], { startMonth: "2026-10", endMonth: "2026-10" }).incomeAmount
    ).toBe(100_000);
  });
});
