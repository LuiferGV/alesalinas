import {
  formatDate,
  formatGs,
  getDaysDiff,
  isDateWithinMonthRange,
  normalizeIsoDate,
  type MonthRange
} from "./date";
import { getFinanceActivityDate } from "./financeEntries";
import { getUniquePractitionerNames, normalizePractitionerName } from "./practitioners";
import type {
  AlertFilter,
  ClinicAlert,
  DashboardMetrics,
  Expense,
  FinanceEntry,
  FollowUp,
  FollowUpBucket,
  Patient,
  PaymentEntry
} from "../types/clinic";

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Historical imports may contain amounts as localized strings. Calculations
 * should never be poisoned by NaN/Infinity or by an invalid negative amount.
 */
function getSafeAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(value, 0) : 0;
  }

  if (typeof value !== "string") return 0;

  const rawValue = value.trim();
  if (!rawValue || rawValue.startsWith("-") || /^\(.*\)$/.test(rawValue)) return 0;

  if (/^\+?\d+$/.test(rawValue)) return Number(rawValue);

  const numericValue = rawValue
    .replace(/(?:gs\.?|pyg)/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!numericValue || numericValue.startsWith("-")) return 0;

  const separators = numericValue.match(/[.,]/g) ?? [];
  let normalizedValue = numericValue;

  if (separators.length > 0) {
    const separator = separators[0]!;
    const sameSeparator = separators.every((current) => current === separator);
    const groups = sameSeparator ? numericValue.split(separator) : [];

    // Guarani amounts are integers and are commonly stored with 3-digit
    // thousands groups (30.350.000 or 30,350,000).
    if (sameSeparator && groups.length > 1 && groups.slice(1).every((group) => group.length === 3)) {
      normalizedValue = groups.join("");
    } else if (numericValue.includes(".") && numericValue.includes(",")) {
      const decimalSeparator = numericValue.lastIndexOf(",") > numericValue.lastIndexOf(".") ? "," : ".";
      const thousandsSeparator = decimalSeparator === "," ? "." : ",";
      normalizedValue = numericValue.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
    } else {
      normalizedValue = numericValue.replace(",", ".");
    }
  }

  const parsedAmount = Number(normalizedValue);
  return Number.isFinite(parsedAmount) ? Math.max(parsedAmount, 0) : 0;
}

type EffectivePayment = PaymentEntry & { amount: number; date: string };

function getEffectivePayments(entry: FinanceEntry): EffectivePayment[] {
  const entryDate = normalizeIsoDate(entry.date) ?? "";
  const payments = asArray(entry.payments)
    .map((payment, index) => ({
      ...payment,
      id: payment.id || `${entry.id}-payment-${index + 1}`,
      date: normalizeIsoDate(payment.date) ?? entryDate,
      amount: getSafeAmount(payment.amount),
      method: payment.method?.trim() || "Otro",
      note: payment.note || ""
    }))
    .filter((payment) => payment.amount > 0);

  // Once detailed payments exist they are the source of truth. Falling back to
  // a stale aggregate in that case would undo a payment correction or deletion.
  if (payments.length > 0) return payments;

  // Typed/normalized entries always carry paidAmount. A stored zero is a real
  // value, not evidence that `total - pending` should be invented here. Legacy
  // inference is done during Firebase normalization, where field presence and
  // validity can be checked safely.
  const legacyPaidAmount = getSafeAmount(entry.paidAmount);

  if (legacyPaidAmount === 0) return [];

  return [
    {
      id: `${entry.id}-legacy-payment-balance`,
      date: entryDate,
      amount: legacyPaidAmount,
      method: "Importado",
      note: entry.description || "Saldo cobrado importado desde un registro anterior."
    }
  ];
}

function getEffectivePaidAmount(entry: FinanceEntry): number {
  return getEffectivePayments(entry).reduce((sum, payment) => sum + payment.amount, 0);
}

function getEffectivePendingAmount(entry: FinanceEntry): number {
  const totalAmount = getSafeAmount(entry.totalAmount);
  if (totalAmount > 0) return Math.max(totalAmount - getEffectivePaidAmount(entry), 0);
  return getSafeAmount(entry.pendingAmount);
}

function getAlertBucket(daysDiff: number): FollowUpBucket {
  if (daysDiff < 0) return "vencido";
  if (daysDiff === 0) return "today";
  if (daysDiff <= 7) return "next7";
  if (daysDiff <= 30) return "next30";
  return "future";
}

export function getClinicAlerts(patients: Patient[], referenceNow = new Date()): ClinicAlert[] {
  return patients
    .flatMap((patient) =>
      patient.followUps
        .filter((followUp) => followUp.status === "Pendiente" || followUp.status === "Reprogramado")
        .map((followUp) => {
          const daysUntilDue = getDaysDiff(followUp.dueDate, referenceNow);

          return {
            id: `${patient.id}-${followUp.id}`,
            patientId: patient.id,
            patientName: patient.fullName,
            patientPhone: patient.phone,
            daysUntilDue,
            dueDate: followUp.dueDate,
            eventDate: followUp.eventDate,
            type: followUp.type,
            source: followUp.source,
            notes: followUp.notes,
            bucket: getAlertBucket(daysUntilDue)
          };
        })
    )
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

export function filterAlerts(alerts: ClinicAlert[], filter: AlertFilter): ClinicAlert[] {
  if (filter === "all") return alerts;
  return alerts.filter((alert) => alert.bucket === filter);
}

export function getAlertCounts(alerts: ClinicAlert[]) {
  return {
    vencido: alerts.filter((alert) => alert.bucket === "vencido").length,
    today: alerts.filter((alert) => alert.bucket === "today").length,
    next7: alerts.filter((alert) => alert.bucket === "next7").length,
    next30: alerts.filter((alert) => alert.bucket === "next30").length,
    future: alerts.filter((alert) => alert.bucket === "future").length
  };
}

export function getDashboardMetrics(
  patients: Patient[],
  expenses: Expense[],
  selectedPeriod: MonthRange
): DashboardMetrics {
  const treatmentsCount = asArray(patients)
    .flatMap((patient) => asArray(patient.treatments))
    .filter((item) => isDateWithinMonthRange(item.date, selectedPeriod)).length;

  const financialEntries = asArray(patients).flatMap((patient) => asArray(patient.finances));
  const incomeAmount = financialEntries
    .flatMap(getEffectivePayments)
    .filter((payment) => isDateWithinMonthRange(payment.date, selectedPeriod))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const pendingEntries = financialEntries.filter(
    (entry) => isDateWithinMonthRange(entry.date, selectedPeriod) && getEffectivePendingAmount(entry) > 0
  );
  const pendingAmount = pendingEntries.reduce((sum, entry) => sum + getEffectivePendingAmount(entry), 0);
  const expensesAmount = getAllExpenses(patients, expenses)
    .filter((entry) => isDateWithinMonthRange(entry.date, selectedPeriod))
    .reduce((sum, entry) => sum + getSafeAmount(entry.amount), 0);

  return {
    patientsCount: asArray(patients).length,
    treatmentsCount,
    incomeAmount,
    pendingAmount,
    expensesAmount,
    netAmount: incomeAmount - expensesAmount,
    pendingCases: pendingEntries.length
  };
}

export function getPatientPendingTotal(patient: Patient): number {
  return asArray(patient.finances).reduce((sum, entry) => sum + getEffectivePendingAmount(entry), 0);
}

export function getPatientPaidTotal(patient: Patient): number {
  return asArray(patient.finances).reduce((sum, entry) => sum + getEffectivePaidAmount(entry), 0);
}

export function getPatientTotalBilled(patient: Patient): number {
  return asArray(patient.finances).reduce((sum, entry) => sum + getSafeAmount(entry.totalAmount), 0);
}

export function getPatientExpenseTotal(patient: Patient): number {
  return asArray(patient.patientExpenses).reduce((sum, entry) => sum + getSafeAmount(entry.amount), 0);
}

export function getPatientNetCollected(patient: Patient): number {
  return getPatientPaidTotal(patient) - getPatientExpenseTotal(patient);
}

export function getPatientProjectedNet(patient: Patient): number {
  return getPatientTotalBilled(patient) - getPatientExpenseTotal(patient);
}

export function getPatientLatestTreatment(patient: Patient) {
  return [...asArray(patient.treatments)].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientLatestPayment(patient: Patient) {
  return asArray(patient.finances)
    .flatMap((entry) =>
      getEffectivePayments(entry).map((payment) => ({
        ...payment,
        concept: entry.concept
      }))
    )
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientDoctors(patient: Patient) {
  return getUniquePractitionerNames(asArray(patient.treatments).map((treatment) => treatment.practitioner));
}

export function getPatientLatestPractitioner(patient: Patient) {
  const latestPractitioner = getPatientLatestTreatment(patient)?.practitioner || "";
  return normalizePractitionerName(latestPractitioner) || null;
}

export function getPatientLatestEvolution(patient: Patient) {
  return [...asArray(patient.evolutions)].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientLatestNote(patient: Patient) {
  return [...asArray(patient.notes)].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPendingCollections(patients: Patient[], selectedPeriod: MonthRange) {
  return asArray(patients)
    .flatMap((patient) =>
      asArray(patient.finances)
        .filter(
          (entry) =>
            isDateWithinMonthRange(entry.date, selectedPeriod) && getEffectivePendingAmount(entry) > 0
        )
        .map((entry) => ({
          patientId: patient.id,
          patientName: patient.fullName,
          financeId: entry.id,
          concept: entry.concept,
          date: normalizeIsoDate(entry.date) ?? entry.date,
          pendingAmount: getEffectivePendingAmount(entry)
        }))
    )
    .sort((left, right) => right.pendingAmount - left.pendingAmount);
}

export function getCollectedIncomeEntries(patients: Patient[], selectedPeriod: MonthRange) {
  return asArray(patients)
    .flatMap((patient) =>
      asArray(patient.finances).flatMap((entry) =>
        getEffectivePayments(entry)
          .filter((payment) => isDateWithinMonthRange(payment.date, selectedPeriod))
          .map((payment) => ({
            patientId: patient.id,
            patientName: patient.fullName,
            financeId: entry.id,
            paymentId: payment.id,
            concept: entry.concept,
            date: payment.date,
            paidAmount: payment.amount,
            method: payment.method
          }))
      )
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getAllExpenses(patients: Patient[], expenses: Expense[]) {
  const generalExpenses = asArray(expenses).map((expense) => ({
    ...expense,
    date: normalizeIsoDate(expense.date) ?? expense.date,
    amount: getSafeAmount(expense.amount),
    scope: expense.scope ?? "general"
  }));

  const patientExpenses = asArray(patients).flatMap((patient) =>
    asArray(patient.patientExpenses).map((expense) => ({
      ...expense,
      date: normalizeIsoDate(expense.date) ?? expense.date,
      amount: getSafeAmount(expense.amount),
      scope: "patient" as const,
      patientId: patient.id,
      patientName: patient.fullName
    }))
  );

  return [...patientExpenses, ...generalExpenses];
}

export function getPeriodExpenses(patients: Patient[], expenses: Expense[], selectedPeriod: MonthRange) {
  return getAllExpenses(patients, expenses)
    .filter((expense) => isDateWithinMonthRange(expense.date, selectedPeriod))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getFinanceStatusLabel(entry: FinanceEntry): string {
  const totalAmount = getSafeAmount(entry.totalAmount);
  const paidAmount = getEffectivePaidAmount(entry);
  const pendingAmount = getEffectivePendingAmount(entry);

  if (pendingAmount === 0 && totalAmount > 0) return "Cobrado";
  if (totalAmount === 0) return "Sin cobro";
  if (paidAmount > 0) return "Pago parcial";
  return "Pendiente";
}

export function getFinanceTimelineLabel(entry: FinanceEntry): string {
  const activityDate = getFinanceActivityDate(entry);
  return activityDate === entry.date ? formatDate(entry.date) : `Ultimo pago ${formatDate(activityDate)}`;
}

export function getAlertSubtitle(alert: ClinicAlert): string {
  return `${alert.type} · ${formatDate(alert.dueDate)}`;
}

export function getBucketLabel(bucket: AlertFilter): string {
  const labels: Record<AlertFilter, string> = {
    all: "Todos",
    vencido: "Vencidos",
    today: "Hoy",
    next7: "Prox. 7 dias",
    next30: "Prox. 30 dias",
    future: "Futuras"
  };

  return labels[bucket];
}

export function getBucketTone(bucket: FollowUpBucket): string {
  if (bucket === "vencido") return "critical";
  if (bucket === "today") return "today";
  if (bucket === "next7") return "soon";
  return "calm";
}

export function getDuePill(alert: ClinicAlert): string {
  if (alert.daysUntilDue < 0) return `Vencido hace ${Math.abs(alert.daysUntilDue)} dia(s)`;
  if (alert.daysUntilDue === 0) return "Vence hoy";
  if (alert.daysUntilDue <= 7) return `En ${alert.daysUntilDue} dia(s)`;
  return formatDate(alert.dueDate);
}

export function buildFinanceCaption(patient: Patient): string {
  return `${formatGs(getPatientPaidTotal(patient))} cobrados · ${formatGs(getPatientPendingTotal(patient))} pendientes`;
}
