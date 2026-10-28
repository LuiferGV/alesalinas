import { describe, expect, it } from "vitest";
import type { Expense, PaymentEntry } from "../types/clinic";
import {
  createFinanceEntry,
  createPaymentEntry,
  relocateFinanceDateLinkedPayments,
  relocateTreatmentDateLinkedExpenses,
  removePaymentFromFinance,
  removePaymentFromFinances,
  replacePaymentInFinance,
  syncFinanceEntry
} from "./financeEntries";

describe("finance payment corrections", () => {
  it("mantiene cobrado consistente con la suma real de pagos", () => {
    const entry = syncFinanceEntry({
      id: "finance-1",
      date: "2026-09-10",
      concept: "Consulta",
      status: "",
      totalAmount: 300_000,
      paidAmount: 0,
      pendingAmount: 0,
      description: "",
      payments: [
        createPaymentEntry({
          id: "payment-1",
          date: "2026-09-10",
          amount: 500_000,
          method: "Efectivo"
        })
      ]
    });

    expect(entry.paidAmount).toBe(500_000);
    expect(entry.pendingAmount).toBe(0);
  });

  it("recalcula saldo al editar un pago", () => {
    const entry = createFinanceEntry({
      id: "finance-1",
      date: "2026-09-10",
      concept: "Consulta",
      totalAmount: 500_000,
      description: "",
      payments: [
        createPaymentEntry({
          id: "payment-1",
          date: "2026-09-10",
          amount: 300_000,
          method: "Efectivo"
        })
      ]
    });

    const updated = replacePaymentInFinance(
      entry,
      createPaymentEntry({
        id: "payment-1",
        date: "2026-10-01",
        amount: 200_000,
        method: "Transferencia"
      })
    );

    expect(updated.payments).toMatchObject([
      { id: "payment-1", date: "2026-10-01", amount: 200_000, method: "Transferencia" }
    ]);
    expect(updated.paidAmount).toBe(200_000);
    expect(updated.pendingAmount).toBe(300_000);
  });

  it("resta el pago eliminado y reabre el saldo", () => {
    const entry = createFinanceEntry({
      id: "finance-1",
      date: "2026-09-10",
      concept: "Consulta",
      totalAmount: 500_000,
      description: "",
      payments: [
        createPaymentEntry({ id: "payment-1", date: "2026-09-10", amount: 200_000 }),
        createPaymentEntry({ id: "payment-2", date: "2026-09-11", amount: 100_000 })
      ]
    });

    const updated = removePaymentFromFinance(entry, "payment-1");

    expect(updated.payments.map((payment) => payment.id)).toEqual(["payment-2"]);
    expect(updated.paidAmount).toBe(100_000);
    expect(updated.pendingAmount).toBe(400_000);
  });

  it("usa deuda y pago como identidad compuesta cuando el id del pago se repite", () => {
    const makeEntry = (financeId: string) =>
      createFinanceEntry({
        id: financeId,
        date: "2026-09-10",
        concept: financeId,
        totalAmount: 200_000,
        description: "",
        payments: [
          createPaymentEntry({ id: "payment-repetido", date: "2026-09-10", amount: 100_000 })
        ]
      });
    const entries = [makeEntry("finance-1"), makeEntry("finance-2")];

    const updated = removePaymentFromFinances(entries, "finance-2", "payment-repetido");

    expect(updated[0].payments).toHaveLength(1);
    expect(updated[0].paidAmount).toBe(100_000);
    expect(updated[1].payments).toHaveLength(0);
    expect(updated[1].paidAmount).toBe(0);
  });
});

describe("finance date corrections", () => {
  const makeEntry = (payments: PaymentEntry[]) =>
    createFinanceEntry({
      id: "finance-1",
      date: "2026-10-15",
      concept: "Consulta",
      totalAmount: 1_000_000,
      description: "",
      payments
    });

  it("mueve el pago creado junto con la atencion a la nueva fecha", () => {
    const entry = makeEntry([
      createPaymentEntry({
        id: "payment-initial",
        date: "2026-10-15",
        amount: 300_000,
        method: "Efectivo",
        note: "Pago registrado junto con la atencion."
      })
    ]);

    const payments = relocateFinanceDateLinkedPayments(entry, "2026-09-20");

    expect(payments).toMatchObject([{ id: "payment-initial", date: "2026-09-20" }]);
    expect(entry.payments[0].date).toBe("2026-10-15");
  });

  it("mueve el pago inicial de un cargo y el pago sintetizado al importar", () => {
    const entry = makeEntry([
      createPaymentEntry({
        id: "payment-initial-charge",
        date: "2026-10-15",
        amount: 200_000,
        method: "Efectivo",
        note: "Pago inicial registrado junto con el cargo."
      }),
      createPaymentEntry({
        id: "finance-1-legacy-payment-2",
        date: "2026-10-15",
        amount: 100_000,
        method: "Importado",
        note: "Detalle historico"
      })
    ]);

    const payments = relocateFinanceDateLinkedPayments(entry, "2026-09-20");

    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "payment-initial-charge", date: "2026-09-20" }),
        expect.objectContaining({ id: "finance-1-legacy-payment-2", date: "2026-09-20" })
      ])
    );
  });

  it("mantiene pagos manuales y alinea cualquier pago inicial identificado", () => {
    const entry = makeEntry([
      createPaymentEntry({
        id: "payment-manual-same-day",
        date: "2026-10-15",
        amount: 100_000,
        method: "Transferencia",
        note: "Pago de la paciente"
      }),
      createPaymentEntry({
        id: "payment-initial-date-edited",
        date: "2026-10-20",
        amount: 100_000,
        method: "Efectivo",
        note: "Pago registrado junto con la atencion."
      }),
      createPaymentEntry({
        id: "payment-imported-manual",
        date: "2026-10-15",
        amount: 100_000,
        method: "Importado",
        note: "Importado manualmente"
      })
    ]);

    const payments = relocateFinanceDateLinkedPayments(entry, "2026-09-20");

    expect(payments.map(({ id, date }) => ({ id, date }))).toEqual([
      { id: "payment-initial-date-edited", date: "2026-09-20" },
      { id: "payment-manual-same-day", date: "2026-10-15" },
      { id: "payment-imported-manual", date: "2026-10-15" }
    ]);
  });
});

describe("treatment expense date corrections", () => {
  const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
    id: "expense-1",
    date: "2026-10-15",
    concept: "Corona",
    category: "Laboratorio",
    amount: 250_000,
    description: "Costo registrado junto con la atencion.",
    scope: "patient",
    linkedTreatmentId: "treatment-1",
    ...overrides
  });

  it("mueve el costo vinculado que conserva la fecha anterior del tratamiento", () => {
    const expenses = [makeExpense()];

    const relocated = relocateTreatmentDateLinkedExpenses(
      expenses,
      "treatment-1",
      "2026-10-15",
      "2026-09-20"
    );

    expect(relocated).toMatchObject([{ id: "expense-1", date: "2026-09-20" }]);
    expect(expenses[0].date).toBe("2026-10-15");
  });

  it("mueve todos los costos del tratamiento y respeta otros vinculos", () => {
    const expenses = [
      makeExpense({ id: "expense-edited", date: "2026-10-20" }),
      makeExpense({ id: "expense-other-treatment", linkedTreatmentId: "treatment-2" }),
      makeExpense({ id: "expense-unlinked", linkedTreatmentId: undefined })
    ];

    const relocated = relocateTreatmentDateLinkedExpenses(
      expenses,
      "treatment-1",
      "2026-10-15",
      "2026-09-20"
    );

    expect(relocated.map(({ id, date }) => ({ id, date }))).toEqual([
      { id: "expense-edited", date: "2026-09-20" },
      { id: "expense-other-treatment", date: "2026-10-15" },
      { id: "expense-unlinked", date: "2026-10-15" }
    ]);
  });

  it("no cambia referencias cuando la fecha del tratamiento no cambia", () => {
    const expenses = [makeExpense()];

    const relocated = relocateTreatmentDateLinkedExpenses(
      expenses,
      "treatment-1",
      "2026-10-15",
      "2026-10-15"
    );

    expect(relocated).toBe(expenses);
  });
});
