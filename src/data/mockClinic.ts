import { toIsoDate } from "../lib/date";
import type { Expense, Patient } from "../types/clinic";

const today = new Date();

export const mockPatients: Patient[] = [];

export const mockExpenses: Expense[] = [];

export const mockSnapshot = {
  lastSyncLabel: toIsoDate(today),
  patients: mockPatients,
  expenses: mockExpenses
};
