import { describe, expect, it } from "vitest";
import {
  createFinanceEntry,
  createPaymentEntry,
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
