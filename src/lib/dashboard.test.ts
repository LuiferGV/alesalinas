import { describe, expect, it } from "vitest";
import {
  getCollectedIncomeEntries,
  getDashboardMetrics,
  getPendingCollections,
  getPeriodExpenses
} from "./dashboard";
import type {
  Expense,
  FinanceEntry,
  Patient,
  PaymentEntry,
  Treatment
} from "../types/clinic";

const september2026 = { startMonth: "2026-09", endMonth: "2026-09" };

function makePayment(id: string, date: string, amount: number): PaymentEntry {
  return {
    id,
    date,
    amount,
    method: "Efectivo",
    note: ""
  };
}

function makeFinance({
  id,
  date,
  totalAmount,
  payments,
  concept = "Consulta"
}: {
  id: string;
  date: string;
  totalAmount: number;
  payments: PaymentEntry[];
  concept?: string;
}): FinanceEntry {
  const paidAmount = Math.min(
    payments.reduce((sum, payment) => sum + payment.amount, 0),
    totalAmount
  );

  return {
    id,
    date,
    concept,
    status: paidAmount === totalAmount ? "Cobrado" : "Pago parcial",
    totalAmount,
    paidAmount,
    pendingAmount: Math.max(totalAmount - paidAmount, 0),
    description: "",
    payments
  };
}

function makePatient(overrides: Pick<Patient, "id"> & Partial<Patient>): Patient {
  const { id, ...patientOverrides } = overrides;

  return {
    id,
    fullName: "Paciente de prueba",
    phone: "+595981000000",
    cedula: "",
    createdAt: "2026-09-01",
    birthDate: "",
    lastVisit: null,
    financeTone: "balanced",
    occupation: "",
    city: "",
    tags: [],
    clinicalSummary: "",
    treatments: [],
    evolutions: [],
    followUps: [],
    notes: [],
    budgets: [],
    finances: [],
    patientExpenses: [],
    ...patientOverrides
  };
}

function makeExpense(id: string, date: string, amount: number, scope: Expense["scope"]): Expense {
  return {
    id,
    date,
    concept: `Egreso ${id}`,
    category: "General",
    amount,
    description: "",
    scope
  };
}

function makeTreatment(id: string, date: string): Treatment {
  return {
    id,
    date,
    category: "Consulta",
    detail: "Control",
    practitioner: "Dra. Test",
    status: "Realizado",
    totalAmount: 0,
    paidAmount: 0,
    pendingAmount: 0,
    note: ""
  };
}

describe("dashboard financial totals", () => {
  it("cuenta fichas distintas aunque tengan exactamente el mismo nombre", () => {
    const patients = [
      makePatient({
        id: "patient-1",
        fullName: "Ana Perez",
        finances: [
          makeFinance({
            id: "finance-1",
            date: "2026-09-03",
            totalAmount: 100_000,
            payments: [makePayment("payment-1", "2026-09-03", 100_000)]
          })
        ],
        patientExpenses: [makeExpense("patient-cost-1", "2026-09-04", 20_000, "patient")]
      }),
      makePatient({
        id: "patient-2",
        fullName: "Ana Perez",
        finances: [
          makeFinance({
            id: "finance-2",
            date: "2026-09-05",
            totalAmount: 250_000,
            payments: [makePayment("payment-2", "2026-09-05", 250_000)]
          })
        ],
        patientExpenses: [makeExpense("patient-cost-2", "2026-09-06", 30_000, "patient")]
      })
    ];

    const metrics = getDashboardMetrics(patients, [], september2026);
    const collectedEntries = getCollectedIncomeEntries(patients, september2026);

    expect(metrics).toMatchObject({
      patientsCount: 2,
      incomeAmount: 350_000,
      expensesAmount: 50_000,
      netAmount: 300_000
    });
    expect(collectedEntries).toHaveLength(2);
    expect(collectedEntries.map((entry) => entry.patientId)).toEqual([
      "patient-2",
      "patient-1"
    ]);
  });

  it("suma todos los pagos aunque compartan fecha y concepto", () => {
    const patient = makePatient({
      id: "patient-1",
      finances: [
        makeFinance({
          id: "finance-1",
          date: "2026-09-10",
          concept: "Limpieza",
          totalAmount: 150_000,
          payments: [
            makePayment("payment-1", "2026-09-10", 100_000),
            makePayment("payment-2", "2026-09-10", 50_000)
          ]
        }),
        makeFinance({
          id: "finance-2",
          date: "2026-09-10",
          concept: "Limpieza",
          totalAmount: 200_000,
          payments: [makePayment("payment-3", "2026-09-10", 200_000)]
        })
      ]
    });

    const metrics = getDashboardMetrics([patient], [], september2026);
    const collectedEntries = getCollectedIncomeEntries([patient], september2026);

    expect(metrics.incomeAmount).toBe(350_000);
    expect(collectedEntries).toHaveLength(3);
    expect(collectedEntries.map((entry) => entry.paymentId).sort()).toEqual([
      "payment-1",
      "payment-2",
      "payment-3"
    ]);
    expect(collectedEntries.map((entry) => entry.paidAmount).sort((left, right) => left - right)).toEqual([
      50_000,
      100_000,
      200_000
    ]);
  });

  it("atribuye el cobro al mes del pago y no al mes del cargo", () => {
    const patient = makePatient({
      id: "patient-1",
      finances: [
        makeFinance({
          id: "finance-1",
          date: "2026-08-31",
          totalAmount: 500_000,
          payments: [
            makePayment("payment-september", "2026-09-15", 300_000),
            makePayment("payment-october", "2026-10-01", 200_000)
          ]
        })
      ]
    });

    expect(getDashboardMetrics([patient], [], september2026).incomeAmount).toBe(300_000);
    expect(getCollectedIncomeEntries([patient], september2026)).toMatchObject([
      {
        patientId: "patient-1",
        date: "2026-09-15",
        paidAmount: 300_000
      }
    ]);
    expect(
      getDashboardMetrics(
        [patient],
        [],
        { startMonth: "2026-10", endMonth: "2026-10" }
      ).incomeAmount
    ).toBe(200_000);
  });

  it("combina costos de pacientes y egresos generales sin omitir ninguno", () => {
    const patient = makePatient({
      id: "patient-1",
      patientExpenses: [
        makeExpense("patient-cost-september", "2026-09-12", 80_000, "patient"),
        makeExpense("patient-cost-august", "2026-08-31", 900_000, "patient")
      ]
    });
    const generalExpenses = [
      makeExpense("general-september", "2026-09-20", 120_000, "general"),
      makeExpense("general-october", "2026-10-01", 700_000, "general")
    ];

    const metrics = getDashboardMetrics([patient], generalExpenses, september2026);
    const periodExpenses = getPeriodExpenses([patient], generalExpenses, september2026);

    expect(metrics.expensesAmount).toBe(200_000);
    expect(periodExpenses).toHaveLength(2);
    expect(periodExpenses.map((expense) => expense.id)).toEqual([
      "general-september",
      "patient-cost-september"
    ]);
    expect(periodExpenses.map((expense) => expense.scope)).toEqual(["general", "patient"]);
  });

  it("incluye los meses y fechas limite de un rango y excluye los movimientos externos", () => {
    const patient = makePatient({
      id: "patient-1",
      treatments: [
        makeTreatment("treatment-before", "2026-07-31"),
        makeTreatment("treatment-first", "2026-08-01"),
        makeTreatment("treatment-middle", "2026-09-15"),
        makeTreatment("treatment-last", "2026-10-31"),
        makeTreatment("treatment-after", "2026-11-01")
      ],
      finances: [
        makeFinance({
          id: "finance-boundaries",
          date: "2026-08-01",
          totalAmount: 1_500,
          payments: [
            makePayment("payment-before", "2026-07-31", 100),
            makePayment("payment-first", "2026-08-01", 200),
            makePayment("payment-middle", "2026-09-15", 300),
            makePayment("payment-last", "2026-10-31", 400),
            makePayment("payment-after", "2026-11-01", 500)
          ]
        })
      ]
    });
    const expenses = [
      makeExpense("expense-before", "2026-07-31", 10, "general"),
      makeExpense("expense-first", "2026-08-01", 20, "general"),
      makeExpense("expense-middle", "2026-09-15", 30, "general"),
      makeExpense("expense-last", "2026-10-31", 40, "general"),
      makeExpense("expense-after", "2026-11-01", 50, "general")
    ];

    const metrics = getDashboardMetrics(
      [patient],
      expenses,
      { startMonth: "2026-08", endMonth: "2026-10" }
    );

    expect(metrics).toMatchObject({
      treatmentsCount: 3,
      incomeAmount: 900,
      expensesAmount: 90,
      netAmount: 810
    });
  });

  it("recalcula cobros y egresos al recibir los registros actualizados", () => {
    const originalPatient = makePatient({
      id: "patient-1",
      finances: [
        makeFinance({
          id: "finance-1",
          date: "2026-09-08",
          totalAmount: 300_000,
          payments: [makePayment("payment-1", "2026-09-08", 100_000)]
        })
      ],
      patientExpenses: [makeExpense("patient-cost-1", "2026-09-08", 20_000, "patient")]
    });
    const originalGeneralExpense = makeExpense("general-1", "2026-09-08", 30_000, "general");

    expect(getDashboardMetrics([originalPatient], [originalGeneralExpense], september2026)).toMatchObject({
      incomeAmount: 100_000,
      expensesAmount: 50_000,
      netAmount: 50_000
    });

    const updatedPatient = makePatient({
      ...originalPatient,
      finances: [
        makeFinance({
          id: "finance-1",
          date: "2026-09-08",
          totalAmount: 300_000,
          payments: [makePayment("payment-1", "2026-09-08", 180_000)]
        })
      ],
      patientExpenses: [makeExpense("patient-cost-1", "2026-09-08", 50_000, "patient")]
    });
    const updatedGeneralExpense = makeExpense("general-1", "2026-09-08", 70_000, "general");

    expect(getDashboardMetrics([updatedPatient], [updatedGeneralExpense], september2026)).toMatchObject({
      incomeAmount: 180_000,
      expensesAmount: 120_000,
      netAmount: 60_000
    });
  });

  it("usa el agregado historico solo cuando no existen pagos detallados", () => {
    const patient = makePatient({
      id: "legacy-patient",
      finances: [
        {
          ...makeFinance({
            id: "legacy-finance",
            date: "5/9/2026",
            totalAmount: 500_000,
            payments: []
          }),
          paidAmount: 300_000,
          pendingAmount: 500_000
        },
        {
          ...makeFinance({
            id: "partially-migrated-finance",
            date: "2026-09-06",
            totalAmount: 400_000,
            payments: [makePayment("explicit-payment", "", 100_000)]
          }),
          paidAmount: 250_000,
          pendingAmount: 400_000
        }
      ]
    });

    const metrics = getDashboardMetrics([patient], [], september2026);
    const collectedEntries = getCollectedIncomeEntries([patient], september2026);
    const pendingEntries = getPendingCollections([patient], september2026);

    expect(metrics).toMatchObject({
      incomeAmount: 400_000,
      pendingAmount: 500_000,
      pendingCases: 2
    });
    expect(collectedEntries).toHaveLength(2);
    expect(collectedEntries.reduce((sum, entry) => sum + entry.paidAmount, 0)).toBe(400_000);
    expect(collectedEntries.every((entry) => entry.date.startsWith("2026-09"))).toBe(true);
    expect(pendingEntries.map((entry) => entry.pendingAmount).sort((left, right) => left - right)).toEqual([
      200_000,
      300_000
    ]);
  });

  it("no inventa un cobro cuando paidAmount es cero aunque el pendiente guardado este viejo", () => {
    const patient = makePatient({
      id: "patient-with-zero-paid",
      finances: [
        {
          ...makeFinance({
            id: "finance-with-zero-paid",
            date: "2026-09-18",
            totalAmount: 500_000,
            payments: []
          }),
          paidAmount: 0,
          pendingAmount: 0
        }
      ]
    });

    expect(getDashboardMetrics([patient], [], september2026)).toMatchObject({
      incomeAmount: 0,
      pendingAmount: 500_000,
      pendingCases: 1
    });
  });

  it("acepta importes historicos localizados y evita que valores invalidos produzcan NaN", () => {
    const localizedPayment = {
      ...makePayment("localized-payment", "30/09/2026", 0),
      amount: "Gs. 1.250.000" as unknown as number
    };
    const invalidPayments = [
      { ...makePayment("nan-payment", "2026-09-30", 0), amount: Number.NaN },
      { ...makePayment("infinite-payment", "2026-09-30", 0), amount: Number.POSITIVE_INFINITY },
      { ...makePayment("negative-payment", "2026-09-30", 0), amount: -100_000 }
    ];
    const patient = makePatient({
      id: "patient-with-imported-values",
      finances: [
        {
          ...makeFinance({
            id: "finance-with-imported-values",
            date: "2026-9-30",
            totalAmount: 1_250_000,
            payments: []
          }),
          paidAmount: 0,
          payments: [localizedPayment, ...invalidPayments]
        }
      ]
    });
    const expenses = [
      {
        ...makeExpense("localized-expense", "2026-09-30T23:59:59.000Z", 0, "general"),
        amount: "250.000" as unknown as number
      },
      { ...makeExpense("invalid-expense", "2026-09-30", 0, "general"), amount: Number.NaN }
    ];

    const metrics = getDashboardMetrics([patient], expenses, september2026);

    expect(metrics).toMatchObject({
      incomeAmount: 1_250_000,
      pendingAmount: 0,
      expensesAmount: 250_000,
      netAmount: 1_000_000
    });
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
  });

  it("recalcula el pendiente desde monto y pagos aunque el valor guardado haya quedado viejo", () => {
    const baseFinance = makeFinance({
      id: "finance-1",
      date: "2026-09-10",
      totalAmount: 300_000,
      payments: [makePayment("payment-1", "2026-09-10", 100_000)]
    });
    const originalPatient = makePatient({
      id: "patient-1",
      finances: [{ ...baseFinance, pendingAmount: 999_999 }]
    });
    const updatedPatient = makePatient({
      id: "patient-1",
      finances: [{ ...baseFinance, totalAmount: 450_000, pendingAmount: 999_999 }]
    });

    expect(getDashboardMetrics([originalPatient], [], september2026).pendingAmount).toBe(200_000);
    expect(getDashboardMetrics([updatedPatient], [], september2026).pendingAmount).toBe(350_000);
  });
});
