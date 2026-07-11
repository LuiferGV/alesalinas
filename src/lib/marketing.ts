import { isDateWithinMonthRange, type MonthRange } from "./date";
import type { Expense, Patient } from "../types/clinic";

export interface MarketingIncomeEntry {
  patientId: string;
  patientName: string;
  concept: string;
  date: string;
  amount: number;
  method?: string;
}

export interface MarketingDashboardData {
  spendAmount: number;
  agencyAmount: number;
  cardAmount: number;
  incomeAmount: number;
  netAmount: number;
  roas: number | null;
  marketingPatientsCount: number;
  expenses: Expense[];
  incomeEntries: MarketingIncomeEntry[];
}

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export function isMarketingExpense(expense: Expense) {
  if ((expense.scope ?? "general") === "patient") return false;

  return (
    Boolean(expense.isMarketing) ||
    normalizeText(expense.category) === "marketing" ||
    Boolean(normalizeText(expense.marketingType))
  );
}

export function getMarketingExpenses(expenses: Expense[], selectedPeriod: MonthRange) {
  return expenses
    .filter((expense) => isMarketingExpense(expense) && isDateWithinMonthRange(expense.date, selectedPeriod))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getMarketingIncomeEntries(patients: Patient[], selectedPeriod: MonthRange): MarketingIncomeEntry[] {
  return patients
    .flatMap((patient) =>
      patient.finances.flatMap((entry) =>
        entry.payments
          .filter((payment) => payment.fromMarketing && isDateWithinMonthRange(payment.date, selectedPeriod))
          .map((payment) => ({
            patientId: patient.id,
            patientName: patient.fullName,
            concept: entry.concept,
            date: payment.date,
            amount: payment.amount,
            method: payment.method
          }))
      )
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getMarketingDashboardData(
  patients: Patient[],
  expenses: Expense[],
  selectedPeriod: MonthRange
): MarketingDashboardData {
  const marketingExpenses = getMarketingExpenses(expenses, selectedPeriod);
  const marketingIncomeEntries = getMarketingIncomeEntries(patients, selectedPeriod);
  const spendAmount = marketingExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const agencyAmount = marketingExpenses
    .filter((expense) => normalizeText(expense.marketingType) === "agencia")
    .reduce((sum, expense) => sum + expense.amount, 0);
  const cardAmount = marketingExpenses
    .filter((expense) => normalizeText(expense.paymentMethod) === "tarjeta")
    .reduce((sum, expense) => sum + expense.amount, 0);
  const incomeAmount = marketingIncomeEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const marketingPatientsCount = new Set(marketingIncomeEntries.map((entry) => entry.patientId)).size;

  return {
    spendAmount,
    agencyAmount,
    cardAmount,
    incomeAmount,
    netAmount: incomeAmount - spendAmount,
    roas: spendAmount > 0 ? incomeAmount / spendAmount : null,
    marketingPatientsCount,
    expenses: marketingExpenses,
    incomeEntries: marketingIncomeEntries
  };
}
