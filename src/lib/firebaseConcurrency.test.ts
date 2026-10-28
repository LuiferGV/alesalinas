import { describe, expect, it } from "vitest";
import type { Expense, FinanceEntry, Patient, PaymentEntry, Treatment } from "../types/clinic";
import { mergePatientChanges, resolvePatientTransactionValue } from "./firebase";
import { syncFinanceEntry } from "./financeEntries";

function createPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "patient-1",
    fullName: "Paciente",
    phone: "",
    cedula: "",
    createdAt: "2026-09-01",
    birthDate: "",
    lastVisit: null,
    financeTone: "review",
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
    ...overrides
  };
}

function createFinance(payments: PaymentEntry[] = [], totalAmount = 1_000_000): FinanceEntry {
  return syncFinanceEntry({
    id: "finance-1",
    date: "2026-09-01",
    concept: "Tratamiento",
    status: "",
    totalAmount,
    paidAmount: 0,
    pendingAmount: totalAmount,
    description: "",
    linkedTreatmentId: "treatment-1",
    payments
  });
}

function createTreatment(): Treatment {
  return {
    id: "treatment-1",
    date: "2026-09-10",
    category: "Consulta",
    detail: "Tratamiento",
    practitioner: "Dra. Alejandra",
    status: "Realizado",
    totalAmount: 1_000_000,
    paidAmount: 0,
    pendingAmount: 1_000_000,
    note: "",
    linkedFinanceId: "finance-1"
  };
}

function createPayment(id: string, amount: number): PaymentEntry {
  return {
    id,
    date: "2026-09-15",
    amount,
    method: "Efectivo",
    note: ""
  };
}

function createExpense(id: string, amount: number): Expense {
  return {
    id,
    date: "2026-09-16",
    concept: id,
    category: "Insumos",
    amount,
    description: "",
    scope: "patient",
    patientId: "patient-1",
    patientName: "Paciente"
  };
}

describe("patient transaction merge", () => {
  it("conserva dos pagos distintos guardados concurrentemente", () => {
    const treatment = createTreatment();
    const base = createPatient({ treatments: [treatment], finances: [createFinance()] });
    const firstChange: Patient = {
      ...base,
      finances: [createFinance([createPayment("payment-a", 150_000)])]
    };
    const secondChange: Patient = {
      ...base,
      finances: [createFinance([createPayment("payment-b", 250_000)])]
    };

    const afterFirstSave = mergePatientChanges(base, firstChange, base);
    const afterSecondSave = mergePatientChanges(base, secondChange, afterFirstSave);
    const finance = afterSecondSave.finances[0];

    expect(finance.payments.map((payment) => payment.id).sort()).toEqual(["payment-a", "payment-b"]);
    expect(finance.paidAmount).toBe(400_000);
    expect(finance.pendingAmount).toBe(600_000);
    expect(afterSecondSave.treatments[0]).toMatchObject({
      totalAmount: 1_000_000,
      paidAmount: 400_000,
      pendingAmount: 600_000
    });
    expect(afterSecondSave.lastVisit).toBe("2026-09-10");
    expect(afterSecondSave.financeTone).toBe("partial");
  });

  it("conserva dos gastos distintos guardados concurrentemente", () => {
    const base = createPatient();
    const firstChange = createPatient({ patientExpenses: [createExpense("expense-a", 100_000)] });
    const secondChange = createPatient({ patientExpenses: [createExpense("expense-b", 200_000)] });

    const afterFirstSave = mergePatientChanges(base, firstChange, base);
    const afterSecondSave = mergePatientChanges(base, secondChange, afterFirstSave);

    expect(afterSecondSave.patientExpenses.map((expense) => expense.id).sort()).toEqual([
      "expense-a",
      "expense-b"
    ]);
    expect(afterSecondSave.patientExpenses.reduce((sum, expense) => sum + expense.amount, 0)).toBe(300_000);
  });

  it("respeta un borrado intencional sin perder una adicion concurrente", () => {
    const existingPayment = createPayment("payment-delete", 100_000);
    const keptPayment = createPayment("payment-keep", 200_000);
    const baseExpense = createExpense("expense-delete", 50_000);
    const base = createPatient({
      finances: [createFinance([existingPayment, keptPayment])],
      patientExpenses: [baseExpense]
    });
    const deleteChange = createPatient({
      finances: [createFinance([keptPayment])],
      patientExpenses: []
    });
    const concurrentChange = createPatient({
      finances: [createFinance([existingPayment, keptPayment, createPayment("payment-new", 75_000)])],
      patientExpenses: [baseExpense, createExpense("expense-new", 25_000)]
    });

    const serverWithConcurrentChange = mergePatientChanges(base, concurrentChange, base);
    const merged = mergePatientChanges(base, deleteChange, serverWithConcurrentChange);

    expect(merged.finances[0].payments.map((payment) => payment.id).sort()).toEqual([
      "payment-keep",
      "payment-new"
    ]);
    expect(merged.finances[0].paidAmount).toBe(275_000);
    expect(merged.patientExpenses.map((expense) => expense.id)).toEqual(["expense-new"]);
  });

  it("rechaza una edicion si la ficha ya fue eliminada en el servidor", () => {
    const base = createPatient();
    const next = { ...base, fullName: "Nombre editado" };

    expect(() => resolvePatientTransactionValue(next, base, null)).toThrow(
      "La ficha del paciente fue eliminada mientras se guardaban los cambios."
    );
  });

  it("rechaza el segundo de dos pagos concurrentes que juntos superan el total", () => {
    const base = createPatient({ finances: [createFinance([], 500_000)] });
    const firstChange: Patient = {
      ...base,
      finances: [createFinance([createPayment("payment-a", 400_000)], 500_000)]
    };
    const secondChange: Patient = {
      ...base,
      finances: [createFinance([createPayment("payment-b", 400_000)], 500_000)]
    };
    const afterFirstSave = mergePatientChanges(base, firstChange, base);

    expect(() => mergePatientChanges(base, secondChange, afterFirstSave)).toThrow(
      'Conflicto de cobros en "Tratamiento": los pagos concurrentes superan el total registrado.'
    );
  });

  it("permite una anomalia preexistente del servidor si el cambio no la empeora", () => {
    const base = createPatient({ finances: [createFinance([], 500_000)] });
    const server = createPatient({
      finances: [createFinance([createPayment("legacy-overage", 600_000)], 500_000)]
    });
    const next: Patient = { ...base, fullName: "Nombre corregido" };

    const merged = mergePatientChanges(base, next, server);

    expect(merged.fullName).toBe("Nombre corregido");
    expect(merged.finances[0].paidAmount).toBe(600_000);
    expect(merged.finances[0].totalAmount).toBe(500_000);
  });
});
