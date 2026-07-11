import type { FinanceEntry, PaymentEntry } from "../types/clinic";

export function describeFinanceStatus(totalAmount: number, paidAmount: number) {
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);
  if (totalAmount === 0) return "No corresponde cobrar";
  if (pendingAmount === 0) return "Cobrado";
  if (paidAmount > 0) return "Pago parcial";
  return "Pendiente con monto";
}

export function sortPaymentsByDateDesc<T extends { date: string }>(payments: T[]) {
  return [...payments].sort((left, right) => right.date.localeCompare(left.date));
}

export function getPaymentsTotal(payments: PaymentEntry[]) {
  return payments.reduce((sum, payment) => sum + Math.max(payment.amount || 0, 0), 0);
}

export function createPaymentEntry({
  id,
  date,
  amount,
  method,
  note,
  fromMarketing
}: {
  id: string;
  date: string;
  amount: number;
  method?: string;
  note?: string;
  fromMarketing?: boolean;
}): PaymentEntry {
  return {
    id,
    date,
    amount: Math.max(amount || 0, 0),
    method: method?.trim() || "Otro",
    note: note?.trim() || "",
    fromMarketing: Boolean(fromMarketing)
  };
}

export function createLegacyPayments(entry: Pick<FinanceEntry, "id" | "date" | "paidAmount" | "description">) {
  if ((entry.paidAmount || 0) <= 0) return [];

  return [
    createPaymentEntry({
      id: `${entry.id}-legacy-payment`,
      date: entry.date,
      amount: entry.paidAmount,
      method: "Importado",
      note: entry.description || "Pago importado desde un registro anterior."
    })
  ];
}

export function syncFinanceEntry(entry: FinanceEntry): FinanceEntry {
  const payments = sortPaymentsByDateDesc(
    (entry.payments ?? []).filter((payment) => Number(payment.amount || 0) > 0)
  ).map((payment) => ({
    ...payment,
    amount: Number(payment.amount || 0),
    method: payment.method?.trim() || "Otro",
    note: payment.note || "",
    fromMarketing: Boolean(payment.fromMarketing)
  }));

  const totalAmount = Math.max(Number(entry.totalAmount || 0), 0);
  const paidAmount = Math.min(getPaymentsTotal(payments), totalAmount);
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);

  return {
    ...entry,
    totalAmount,
    payments,
    paidAmount,
    pendingAmount,
    status: describeFinanceStatus(totalAmount, paidAmount)
  };
}

export function createFinanceEntry(entry: Omit<FinanceEntry, "status" | "paidAmount" | "pendingAmount">): FinanceEntry {
  return syncFinanceEntry({
    ...entry,
    status: "",
    paidAmount: 0,
    pendingAmount: 0
  });
}

export function getFinanceActivityDate(entry: FinanceEntry) {
  const latestPaymentDate = entry.payments[0]?.date;
  if (!latestPaymentDate) return entry.date;
  return latestPaymentDate > entry.date ? latestPaymentDate : entry.date;
}

export function sortFinancesByActivity(entries: FinanceEntry[]) {
  return [...entries].sort((left, right) => getFinanceActivityDate(right).localeCompare(getFinanceActivityDate(left)));
}

export function appendPaymentToFinance(entry: FinanceEntry, payment: PaymentEntry) {
  return syncFinanceEntry({
    ...entry,
    payments: [payment, ...(entry.payments ?? [])]
  });
}
