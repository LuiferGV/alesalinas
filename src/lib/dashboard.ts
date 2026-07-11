import { formatDate, formatGs, getDaysDiff, isDateWithinMonthRange, type MonthRange } from "./date";
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
  Patient
} from "../types/clinic";

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
  const treatmentsCount = patients
    .flatMap((patient) => patient.treatments)
    .filter((item) => isDateWithinMonthRange(item.date, selectedPeriod)).length;

  const financialEntries = patients.flatMap((patient) => patient.finances);
  const incomeAmount = financialEntries
    .flatMap((entry) => entry.payments)
    .filter((payment) => isDateWithinMonthRange(payment.date, selectedPeriod))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const pendingEntries = financialEntries.filter(
    (entry) => isDateWithinMonthRange(entry.date, selectedPeriod) && entry.pendingAmount > 0
  );
  const pendingAmount = pendingEntries.reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const expensesAmount = getAllExpenses(patients, expenses)
    .filter((entry) => isDateWithinMonthRange(entry.date, selectedPeriod))
    .reduce((sum, entry) => sum + entry.amount, 0);

  return {
    patientsCount: patients.length,
    treatmentsCount,
    incomeAmount,
    pendingAmount,
    expensesAmount,
    netAmount: incomeAmount - expensesAmount,
    pendingCases: pendingEntries.length
  };
}

export function getPatientPendingTotal(patient: Patient): number {
  return patient.finances.reduce((sum, entry) => sum + entry.pendingAmount, 0);
}

export function getPatientPaidTotal(patient: Patient): number {
  return patient.finances.reduce(
    (sum, entry) => sum + entry.payments.reduce((entrySum, payment) => entrySum + payment.amount, 0),
    0
  );
}

export function getPatientTotalBilled(patient: Patient): number {
  return patient.finances.reduce((sum, entry) => sum + entry.totalAmount, 0);
}

export function getPatientExpenseTotal(patient: Patient): number {
  return patient.patientExpenses.reduce((sum, entry) => sum + entry.amount, 0);
}

export function getPatientNetCollected(patient: Patient): number {
  return getPatientPaidTotal(patient) - getPatientExpenseTotal(patient);
}

export function getPatientProjectedNet(patient: Patient): number {
  return getPatientTotalBilled(patient) - getPatientExpenseTotal(patient);
}

export function getPatientLatestTreatment(patient: Patient) {
  return [...patient.treatments].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientLatestPayment(patient: Patient) {
  return patient.finances
    .flatMap((entry) =>
      entry.payments.map((payment) => ({
        ...payment,
        concept: entry.concept
      }))
    )
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientDoctors(patient: Patient) {
  return getUniquePractitionerNames(patient.treatments.map((treatment) => treatment.practitioner));
}

export function getPatientLatestPractitioner(patient: Patient) {
  const latestPractitioner = getPatientLatestTreatment(patient)?.practitioner || "";
  return normalizePractitionerName(latestPractitioner) || null;
}

export function getPatientLatestEvolution(patient: Patient) {
  return [...patient.evolutions].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPatientLatestNote(patient: Patient) {
  return [...patient.notes].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function getPendingCollections(patients: Patient[], selectedPeriod: MonthRange) {
  return patients
    .flatMap((patient) =>
      patient.finances
        .filter((entry) => isDateWithinMonthRange(entry.date, selectedPeriod) && entry.pendingAmount > 0)
        .map((entry) => ({
          patientId: patient.id,
          patientName: patient.fullName,
          concept: entry.concept,
          date: entry.date,
          pendingAmount: entry.pendingAmount
        }))
    )
    .sort((left, right) => right.pendingAmount - left.pendingAmount);
}

export function getCollectedIncomeEntries(patients: Patient[], selectedPeriod: MonthRange) {
  return patients
    .flatMap((patient) =>
      patient.finances.flatMap((entry) =>
        entry.payments
          .filter((payment) => isDateWithinMonthRange(payment.date, selectedPeriod))
          .map((payment) => ({
            patientId: patient.id,
            patientName: patient.fullName,
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
  const generalExpenses = expenses.map((expense) => ({
    ...expense,
    scope: expense.scope ?? "general"
  }));

  const patientExpenses = patients.flatMap((patient) =>
    patient.patientExpenses.map((expense) => ({
      ...expense,
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
  if (entry.pendingAmount === 0 && entry.totalAmount > 0) return "Cobrado";
  if (entry.totalAmount === 0) return "Sin cobro";
  if (entry.paidAmount > 0) return "Pago parcial";
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
