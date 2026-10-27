import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { getDatabase, onValue, ref, remove, set } from "firebase/database";
import { normalizeBudgetStatus, sortBudgetsByDateDesc, syncBudgetEntry } from "./budgets";
import { normalizeParaguayPhone, toIsoDate } from "./date";
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
    throw new Error("Falta la configuracion base del sistema.");
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
    throw new Error("Falta completar la conexion de datos del sistema.");
  }

  if (!databaseInstance) {
    databaseInstance = getDatabase(ensureApp());
  }

  return databaseInstance;
}

function getLocalTodayKey(): string {
  return toIsoDate(new Date());
}

export function normalizeStoredAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  if (typeof value !== "string") return 0;

  const rawValue = value.trim();
  if (
    !rawValue ||
    rawValue.includes("-") ||
    (rawValue.includes("(") && rawValue.includes(")"))
  ) {
    return 0;
  }

  const numericValue = rawValue.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numericValue)) return 0;

  const dotMatches = numericValue.match(/\./g)?.length ?? 0;
  const commaMatches = numericValue.match(/,/g)?.length ?? 0;
  const lastDotIndex = numericValue.lastIndexOf(".");
  const lastCommaIndex = numericValue.lastIndexOf(",");
  const lastSeparatorIndex = Math.max(lastDotIndex, lastCommaIndex);
  const digitsAfterLastSeparator =
    lastSeparatorIndex >= 0 ? numericValue.length - lastSeparatorIndex - 1 : 0;
  const hasBothSeparators = dotMatches > 0 && commaMatches > 0;
  const hasSingleSeparator = dotMatches + commaMatches === 1;
  const treatsLastSeparatorAsDecimal =
    digitsAfterLastSeparator > 0 &&
    digitsAfterLastSeparator <= 2 &&
    (hasBothSeparators || hasSingleSeparator);

  const normalizedValue = treatsLastSeparatorAsDecimal
    ? `${numericValue.slice(0, lastSeparatorIndex).replace(/[^\d]/g, "")}.${numericValue
        .slice(lastSeparatorIndex + 1)
        .replace(/[^\d]/g, "")}`
    : numericValue.replace(/[^\d]/g, "");
  const amount = Number(normalizedValue);

  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function reserveUniqueId(candidate: unknown, fallbackId: string, usedIds: Set<string>): string {
  const candidateId = String(candidate ?? "").trim();
  const baseId = candidateId || fallbackId;
  let nextId = baseId;
  let duplicateIndex = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedIds.add(nextId);
  return nextId;
}

export function normalizeFirebaseCollection<T>(value: unknown, fallbackPrefix = "item"): T[] {
  if (!value || typeof value !== "object") return [];

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  const validEntries = entries.filter(
    (entry): entry is readonly [string, Record<string, unknown>] =>
      Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1])
  );
  const isArrayLikeObject =
    !isArray && validEntries.length > 0 && validEntries.every(([firebaseKey]) => /^\d+$/.test(firebaseKey));
  const preserveEmbeddedIds = isArray || isArrayLikeObject;
  const usedIds = new Set<string>();

  return validEntries.map(([firebaseKey, item], index) => {
    const fallbackId = `${fallbackPrefix}-${index + 1}`;
    const preferredId = preserveEmbeddedIds ? item.id : firebaseKey;
    const id = reserveUniqueId(preferredId, fallbackId, usedIds);

    return {
      ...item,
      id
    } as T;
  });
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
  fallbackScope: ExpenseScope = "general",
  fallbackDate = getLocalTodayKey()
): Expense {
  const scope =
    rawExpense.scope === "patient" || rawExpense.scope === "general"
      ? rawExpense.scope
      : fallbackScope;

  return {
    id: rawId,
    date: String(rawExpense.date || fallbackDate).slice(0, 10),
    concept: String(rawExpense.concept || "Sin concepto"),
    category: String(rawExpense.category || "General"),
    amount: normalizeStoredAmount(rawExpense.amount),
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
  const fallbackDate = getLocalTodayKey();
  const rawFinances = normalizeFirebaseCollection<Record<string, unknown>>(rawPatient.finances, "finance");
  const finances = rawFinances.map((entry, index) => {
    const id = String(entry.id || `finance-${index + 1}`);
    const normalizedPayments = normalizeFirebaseCollection<Record<string, unknown>>(
      entry.payments,
      `${id}-payment`
    )
      .map((payment, paymentIndex) => ({
        id: String(payment.id || `${id}-payment-${paymentIndex + 1}`),
        date: String(payment.date || entry.date || fallbackDate).slice(0, 10),
        amount: normalizeStoredAmount(payment.amount),
        method: String(payment.method || "Otro"),
        note: String(payment.note || ""),
        fromMarketing: Boolean(payment.fromMarketing)
      }))
      .filter((payment) => payment.amount > 0);
    const legacyPaidAmount = normalizeStoredAmount(entry.paidAmount);
    const payments =
      normalizedPayments.length > 0
        ? normalizedPayments
        : createLegacyPayments({
            id,
            date: String(entry.date || fallbackDate).slice(0, 10),
            paidAmount: legacyPaidAmount,
            description: String(entry.description || "")
          });

    return syncFinanceEntry({
      id,
      date: String(entry.date || fallbackDate).slice(0, 10),
      concept: String(entry.concept || "Sin concepto"),
      practitioner: entry.practitioner ? String(entry.practitioner) : undefined,
      status: String(entry.status || ""),
      totalAmount: normalizeStoredAmount(entry.totalAmount),
      paidAmount: legacyPaidAmount,
      pendingAmount: normalizeStoredAmount(entry.pendingAmount),
      description: String(entry.description || ""),
      linkedTreatmentId: entry.linkedTreatmentId ? String(entry.linkedTreatmentId) : undefined,
      payments
    });
  });
  const orderedFinances = sortFinancesByActivity(finances);
  const pendingTotal = orderedFinances.reduce((sum, entry) => sum + Number(entry.pendingAmount || 0), 0);
  const patientExpensesSource = rawPatient.patientExpenses || rawPatient.expenses;
  const patientExpenses = normalizeFirebaseCollection<Record<string, unknown>>(
    patientExpensesSource,
    "patient-expense"
  ).map((expense, index) =>
    normalizeExpense(String(expense.id || `patient-expense-${index + 1}`), expense, "patient", fallbackDate)
  );
  const budgets = sortBudgetsByDateDesc(
    normalizeFirebaseCollection<Record<string, unknown>>(rawPatient.budgets, "budget").map((budget, index) =>
      syncBudgetEntry({
        id: String(budget.id || `budget-${index + 1}`),
        budgetNumber: String(budget.budgetNumber || ""),
        status: normalizeBudgetStatus(String(budget.status || "Pendiente")),
        createdAt: String(budget.createdAt || fallbackDate).slice(0, 10),
        validityDays: Number(budget.validityDays || 15) === 30 ? 30 : 15,
        validUntil: String(budget.validUntil || ""),
        note: String(budget.note || ""),
        items: normalizeFirebaseCollection<Record<string, unknown>>(budget.items, "budget-item").map((item, itemIndex) => ({
          id: String(item.id || `budget-item-${itemIndex + 1}`),
          quantity: Number(item.quantity || 0),
          detail: String(item.detail || ""),
          unitPrice: normalizeStoredAmount(item.unitPrice),
          totalPrice: normalizeStoredAmount(item.totalPrice)
        })),
        totalAmount: normalizeStoredAmount(budget.totalAmount)
      })
    )
  );

  return {
    id: rawId,
    fullName: String(rawPatient.fullName || rawPatient.name || "Paciente sin nombre"),
    phone: normalizeParaguayPhone(String(rawPatient.phone || "")),
    cedula: String(rawPatient.cedula || rawPatient.identityNumber || rawPatient.idNumber || ""),
    createdAt: String(rawPatient.createdAt || fallbackDate).slice(0, 10),
    birthDate: String(rawPatient.birthDate || ""),
    lastVisit: rawPatient.lastVisit ? String(rawPatient.lastVisit).slice(0, 10) : null,
    financeTone: inferFinanceTone(String(rawPatient.financeTone || rawPatient.financeStatus || ""), pendingTotal),
    occupation: String(rawPatient.occupation || ""),
    city: String(rawPatient.city || ""),
    tags: Array.isArray(rawPatient.tags) ? rawPatient.tags.map(String) : [],
    clinicalSummary: String(rawPatient.clinicalSummary || ""),
    treatments: normalizeFirebaseCollection<Patient["treatments"][number]>(rawPatient.treatments, "treatment").map((treatment) => ({
      ...treatment,
      practitioner: String(treatment.practitioner || ""),
      totalAmount: normalizeStoredAmount(treatment.totalAmount),
      paidAmount: normalizeStoredAmount(treatment.paidAmount),
      pendingAmount: normalizeStoredAmount(treatment.pendingAmount),
      linkedFinanceId: treatment.linkedFinanceId ? String(treatment.linkedFinanceId) : undefined
    })),
    evolutions: normalizeFirebaseCollection<Patient["evolutions"][number]>(rawPatient.evolutions, "evolution"),
    followUps: normalizeFirebaseCollection<Patient["followUps"][number]>(rawPatient.followUps, "followup"),
    notes: normalizeFirebaseCollection<Patient["notes"][number]>(rawPatient.notes, "note"),
    budgets,
    finances: orderedFinances,
    patientExpenses
  };
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, stripUndefinedDeep(nestedValue)])
    ) as T;
  }

  return value;
}

function serializePatient(patient: Patient): Omit<Patient, "id"> {
  const { id: _id, ...patientPayload } = patient;
  return stripUndefinedDeep(patientPayload);
}

function serializeExpense(expense: Expense): Omit<Expense, "id"> {
  const { id: _id, ...expensePayload } = expense;
  return stripUndefinedDeep(expensePayload);
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

export async function registerWithEmail(email: string, password: string) {
  const auth = ensureAuth();
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function sendResetPasswordEmail(email: string) {
  const auth = ensureAuth();
  return sendPasswordResetEmail(auth, email);
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
  await set(ref(database, `odontologia/egresos/${expense.id}`), serializeExpense(expense));
}

export async function deleteExpense(expenseId: string) {
  const database = ensureDatabase();
  await remove(ref(database, `odontologia/egresos/${expenseId}`));
}
