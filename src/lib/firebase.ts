import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getDatabase, onValue, ref, remove, set } from "firebase/database";
import { normalizeBudgetStatus, sortBudgetsByDateDesc, syncBudgetEntry } from "./budgets";
import { createLegacyPayments, sortFinancesByActivity, syncFinanceEntry } from "./financeEntries";
import type { Expense, ExpenseScope, FinanceTone, Patient } from "../types/clinic";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const coreRequiredKeys = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId
];

const databaseRequiredKeys = [...coreRequiredKeys, firebaseConfig.databaseURL];

export function hasFirebaseCoreConfig(): boolean {
  return coreRequiredKeys.every(Boolean);
}

export function hasRealtimeDatabaseConfig(): boolean {
  return databaseRequiredKeys.every(Boolean);
}

function ensureApp() {
  if (!hasFirebaseCoreConfig()) {
    throw new Error("Falta la configuracion base de Firebase.");
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

let authInstance: ReturnType<typeof getAuth> | null = null;
let databaseInstance: ReturnType<typeof getDatabase> | null = null;

function ensureAuth() {
  if (!authInstance) {
    authInstance = getAuth(ensureApp());
  }

  return authInstance;
}

function ensureDatabase() {
  if (!hasRealtimeDatabaseConfig()) {
    throw new Error("Falta databaseURL para conectar Realtime Database.");
  }

  if (!databaseInstance) {
    databaseInstance = getDatabase(ensureApp());
  }

  return databaseInstance;
}

function normalizeCollection<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean) as T[];
  if (typeof value === "object") {
    return Object.entries(value as Record<string, T>).map(([id, item]) => ({
      id,
      ...(item as object)
    })) as T[];
  }
  return [];
}

function inferFinanceTone(rawTone: string | undefined, pendingTotal: number): FinanceTone {
  if (rawTone === "balanced" || rawTone === "partial" || rawTone === "pending" || rawTone === "review") {
    return rawTone;
  }
  if (pendingTotal === 0) return "balanced";
  return pendingTotal > 500000 ? "pending" : "partial";
}

function normalizeExpense(
  rawId: string,
  rawExpense: Record<string, unknown>,
  fallbackScope: ExpenseScope = "general"
): Expense {
  const scope =
    rawExpense.scope === "patient" || rawExpense.scope === "general"
      ? rawExpense.scope
      : fallbackScope;

  return {
    id: rawId,
    date: String(rawExpense.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    concept: String(rawExpense.concept || "Sin concepto"),
    category: String(rawExpense.category || "General"),
    amount: Number(rawExpense.amount || 0),
    description: String(rawExpense.description || ""),
    scope,
    patientId: rawExpense.patientId ? String(rawExpense.patientId) : undefined,
    patientName: rawExpense.patientName ? String(rawExpense.patientName) : undefined,
    linkedTreatmentId: rawExpense.linkedTreatmentId ? String(rawExpense.linkedTreatmentId) : undefined,
    paymentMethod: rawExpense.paymentMethod ? String(rawExpense.paymentMethod) : undefined,
    vendor: rawExpense.vendor ? String(rawExpense.vendor) : undefined,
    marketingType: rawExpense.marketingType ? String(rawExpense.marketingType) : undefined,
    isMarketing:
      typeof rawExpense.isMarketing === "boolean"
        ? rawExpense.isMarketing
        : String(rawExpense.category || "").trim().toLowerCase() === "marketing"
  };
}

function normalizePatient(rawId: string, rawPatient: Record<string, unknown>): Patient {
  const rawFinances = normalizeCollection<Record<string, unknown>>(rawPatient.finances);
  const finances = rawFinances.map((entry, index) => {
    const id = String(entry.id || `finance-${index + 1}`);
    const payments = normalizeCollection<Record<string, unknown>>(entry.payments).map((payment, paymentIndex) => ({
      id: String(payment.id || `${id}-payment-${paymentIndex + 1}`),
      date: String(payment.date || entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      amount: Number(payment.amount || 0),
      method: String(payment.method || "Otro"),
      note: String(payment.note || ""),
      fromMarketing: Boolean(payment.fromMarketing)
    }));

    return syncFinanceEntry({
      id,
      date: String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      concept: String(entry.concept || "Sin concepto"),
      practitioner: entry.practitioner ? String(entry.practitioner) : undefined,
      status: String(entry.status || ""),
      totalAmount: Number(entry.totalAmount || 0),
      paidAmount: Number(entry.paidAmount || 0),
      pendingAmount: Number(entry.pendingAmount || 0),
      description: String(entry.description || ""),
      linkedTreatmentId: entry.linkedTreatmentId ? String(entry.linkedTreatmentId) : undefined,
      payments: payments.length > 0 ? payments : createLegacyPayments({
        id,
        date: String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        paidAmount: Number(entry.paidAmount || 0),
        description: String(entry.description || "")
      })
    });
  });
  const orderedFinances = sortFinancesByActivity(finances);
  const pendingTotal = orderedFinances.reduce((sum, entry) => sum + Number(entry.pendingAmount || 0), 0);
  const patientExpensesSource = rawPatient.patientExpenses || rawPatient.expenses;
  const patientExpenses = normalizeCollection<Record<string, unknown>>(patientExpensesSource).map((expense, index) =>
    normalizeExpense(String(expense.id || `patient-expense-${index + 1}`), expense, "patient")
  );
  const budgets = sortBudgetsByDateDesc(
    normalizeCollection<Record<string, unknown>>(rawPatient.budgets).map((budget, index) =>
      syncBudgetEntry({
        id: String(budget.id || `budget-${index + 1}`),
        budgetNumber: String(budget.budgetNumber || ""),
        status: normalizeBudgetStatus(String(budget.status || "Pendiente")),
        createdAt: String(budget.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 10),
        validityDays: Number(budget.validityDays || 15) === 30 ? 30 : 15,
        validUntil: String(budget.validUntil || ""),
        note: String(budget.note || ""),
        items: normalizeCollection<Record<string, unknown>>(budget.items).map((item, itemIndex) => ({
          id: String(item.id || `budget-item-${itemIndex + 1}`),
          quantity: Number(item.quantity || 0),
          detail: String(item.detail || ""),
          unitPrice: Number(item.unitPrice || 0),
          totalPrice: Number(item.totalPrice || 0)
        })),
        totalAmount: Number(budget.totalAmount || 0)
      })
    )
  );

  return {
    id: rawId,
    fullName: String(rawPatient.fullName || rawPatient.name || "Paciente sin nombre"),
    phone: String(rawPatient.phone || ""),
    createdAt: String(rawPatient.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 10),
    birthDate: String(rawPatient.birthDate || ""),
    lastVisit: rawPatient.lastVisit ? String(rawPatient.lastVisit).slice(0, 10) : null,
    financeTone: inferFinanceTone(String(rawPatient.financeTone || rawPatient.financeStatus || ""), pendingTotal),
    occupation: String(rawPatient.occupation || ""),
    city: String(rawPatient.city || ""),
    tags: Array.isArray(rawPatient.tags) ? rawPatient.tags.map(String) : [],
    clinicalSummary: String(rawPatient.clinicalSummary || ""),
    treatments: normalizeCollection<Patient["treatments"][number]>(rawPatient.treatments).map((treatment) => ({
      ...treatment,
      practitioner: String(treatment.practitioner || ""),
      totalAmount: Number(treatment.totalAmount || 0),
      paidAmount: Number(treatment.paidAmount || 0),
      pendingAmount: Number(treatment.pendingAmount || 0),
      linkedFinanceId: treatment.linkedFinanceId ? String(treatment.linkedFinanceId) : undefined
    })),
    evolutions: normalizeCollection<Patient["evolutions"][number]>(rawPatient.evolutions),
    followUps: normalizeCollection<Patient["followUps"][number]>(rawPatient.followUps),
    notes: normalizeCollection<Patient["notes"][number]>(rawPatient.notes),
    budgets,
    finances: orderedFinances,
    patientExpenses
  };
}

function serializePatient(patient: Patient): Omit<Patient, "id"> {
  const { id: _id, ...patientPayload } = patient;
  return patientPayload;
}

export function subscribeAuth(
  onChange: (user: User | null) => void,
  onError?: (error: Error) => void
) {
  const auth = ensureAuth();
  return onAuthStateChanged(auth, onChange, onError);
}

export async function signIn(email: string, password: string) {
  const auth = ensureAuth();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOutSession() {
  const auth = ensureAuth();
  return signOut(auth);
}

export function subscribePatients(
  onChange: (patients: Patient[]) => void,
  onError?: (error: Error) => void
) {
  const database = ensureDatabase();
  const patientsRef = ref(database, "odontologia/pacientes");

  return onValue(
    patientsRef,
    (snapshot) => {
      const value = snapshot.val() || {};
      const patients = Object.entries(value as Record<string, Record<string, unknown>>).map(([id, rawPatient]) =>
        normalizePatient(id, rawPatient)
      );
      onChange(patients);
    },
    (error) => onError?.(error)
  );
}

export function subscribeExpenses(
  onChange: (expenses: Expense[]) => void,
  onError?: (error: Error) => void
) {
  const database = ensureDatabase();
  const expensesRef = ref(database, "odontologia/egresos");

  return onValue(
    expensesRef,
    (snapshot) => {
      const value = snapshot.val() || {};
      const expenses = Object.entries(value as Record<string, Record<string, unknown>>).map(([id, rawExpense]) =>
        normalizeExpense(id, rawExpense)
      );
      onChange(expenses);
    },
    (error) => onError?.(error)
  );
}

export function subscribeServerTimeOffset(
  onChange: (offsetMs: number) => void,
  onError?: (error: Error) => void
) {
  const database = ensureDatabase();
  const offsetRef = ref(database, ".info/serverTimeOffset");

  return onValue(
    offsetRef,
    (snapshot) => {
      const offsetMs = snapshot.val();
      onChange(typeof offsetMs === "number" ? offsetMs : 0);
    },
    (error) => onError?.(error)
  );
}

export async function savePatient(patient: Patient) {
  const database = ensureDatabase();
  await set(ref(database, `odontologia/pacientes/${patient.id}`), serializePatient(patient));
}

export async function deletePatient(patientId: string) {
  const database = ensureDatabase();
  await remove(ref(database, `odontologia/pacientes/${patientId}`));
}

export async function saveExpense(expense: Expense) {
  const database = ensureDatabase();
  const { id, ...expensePayload } = expense;
  await set(ref(database, `odontologia/egresos/${id}`), expensePayload);
}

export async function deleteExpense(expenseId: string) {
  const database = ensureDatabase();
  await remove(ref(database, `odontologia/egresos/${expenseId}`));
}
