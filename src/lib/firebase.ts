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
import { get, getDatabase, onValue, ref, remove, runTransaction, set } from "firebase/database";
import { normalizeBudgetStatus, sortBudgetsByDateDesc, syncBudgetEntry } from "./budgets";
import { normalizeParaguayPhone, toIsoDate } from "./date";
import {
  createLegacyPayments,
  relocateFinanceDateLinkedPayments,
  sortFinancesByActivity,
  syncFinanceEntry
} from "./financeEntries";
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

function buildIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(year, month, 0).getDate()
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseStoredDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toIsoDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    const parsedDate = new Date(timestamp);
    return Number.isNaN(parsedDate.getTime()) ? null : toIsoDate(parsedDate);
  }

  if (typeof value !== "string") return null;

  const rawValue = value.trim();
  if (!rawValue) return null;

  const isoMatch = rawValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return buildIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const localMatch = rawValue.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s].*)?$/);
  if (localMatch) {
    return buildIsoDate(Number(localMatch[3]), Number(localMatch[2]), Number(localMatch[1]));
  }

  if (/^\d{10,13}$/.test(rawValue)) {
    return parseStoredDate(Number(rawValue));
  }

  return null;
}

export function normalizeStoredDate(value: unknown, fallbackDate = getLocalTodayKey()): string {
  return parseStoredDate(value) ?? parseStoredDate(fallbackDate) ?? getLocalTodayKey();
}

function normalizeFirstStoredDate(values: unknown[], fallbackDate = ""): string {
  for (const value of values) {
    const normalizedDate = parseStoredDate(value);
    if (normalizedDate) return normalizedDate;
  }

  return parseStoredDate(fallbackDate) ?? "";
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

function isValidStoredAmount(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;

  const rawValue = value.trim();
  if (
    !rawValue ||
    rawValue.includes("-") ||
    (rawValue.includes("(") && rawValue.includes(")"))
  ) {
    return false;
  }

  const digits = rawValue.replace(/[^\d]/g, "");
  if (!digits) return false;

  return normalizeStoredAmount(rawValue) > 0 || /^0+$/.test(digits);
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
  fallbackDate = ""
): Expense {
  const scope =
    rawExpense.scope === "patient" || rawExpense.scope === "general"
      ? rawExpense.scope
      : fallbackScope;

  return {
    id: rawId,
    date: normalizeFirstStoredDate(
      [rawExpense.date, rawExpense.fecha, rawExpense.expenseDate, rawExpense.createdAt],
      fallbackDate
    ),
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

function areEquivalentExpenses(left: Expense, right: Expense): boolean {
  return (
    left.date === right.date &&
    left.concept === right.concept &&
    left.category === right.category &&
    left.amount === right.amount &&
    left.description === right.description &&
    left.scope === right.scope &&
    left.linkedTreatmentId === right.linkedTreatmentId &&
    left.paymentMethod === right.paymentMethod &&
    left.vendor === right.vendor &&
    left.marketingType === right.marketingType &&
    left.isMarketing === right.isMarketing
  );
}

export function normalizePatient(rawId: string, rawPatient: Record<string, unknown>): Patient {
  const fallbackDate = normalizeFirstStoredDate(
    [rawPatient.createdAt, rawPatient.lastVisit],
    ""
  );
  const treatments = normalizeFirebaseCollection<Patient["treatments"][number]>(
    rawPatient.treatments,
    "treatment"
  ).map((treatment) => ({
    ...treatment,
    date: normalizeFirstStoredDate(
      [
        treatment.date,
        (treatment as unknown as Record<string, unknown>).fecha,
        (treatment as unknown as Record<string, unknown>).createdAt
      ],
      fallbackDate
    ),
    practitioner: String(treatment.practitioner || ""),
    totalAmount: normalizeStoredAmount(treatment.totalAmount),
    paidAmount: normalizeStoredAmount(treatment.paidAmount),
    pendingAmount: normalizeStoredAmount(treatment.pendingAmount),
    linkedFinanceId: treatment.linkedFinanceId ? String(treatment.linkedFinanceId) : undefined
  }));
  const treatmentDates = new Map(treatments.map((treatment) => [treatment.id, treatment.date]));
  const treatmentsByFinanceId = new Map<string, Patient["treatments"][number]>();
  treatments.forEach((treatment) => {
    if (treatment.linkedFinanceId && !treatmentsByFinanceId.has(treatment.linkedFinanceId)) {
      treatmentsByFinanceId.set(treatment.linkedFinanceId, treatment);
    }
  });
  const rawFinances = normalizeFirebaseCollection<Record<string, unknown>>(rawPatient.finances, "finance");
  const finances = rawFinances.map((entry, index) => {
    const id = String(entry.id || `finance-${index + 1}`);
    const explicitLinkedTreatmentId = entry.linkedTreatmentId
      ? String(entry.linkedTreatmentId)
      : undefined;
    const inverselyLinkedTreatment = treatmentsByFinanceId.get(id);
    const linkedTreatmentId = treatmentDates.has(explicitLinkedTreatmentId || "")
      ? explicitLinkedTreatmentId
      : inverselyLinkedTreatment?.id || explicitLinkedTreatmentId;
    const previousFinanceDate = normalizeFirstStoredDate(
      [entry.date, entry.fecha, entry.financeDate, entry.createdAt],
      ""
    );
    const linkedTreatmentDate = linkedTreatmentId ? treatmentDates.get(linkedTreatmentId) : "";
    const financeDate = linkedTreatmentDate || previousFinanceDate || fallbackDate;
    const normalizedPaymentsBeforeDateRepair = normalizeFirebaseCollection<Record<string, unknown>>(
      entry.payments,
      `${id}-payment`
    )
      .map((payment, paymentIndex) => ({
        id: String(payment.id || `${id}-payment-${paymentIndex + 1}`),
        date: normalizeFirstStoredDate(
          [payment.date, payment.fecha, payment.paymentDate, payment.paidAt, payment.createdAt],
          financeDate
        ),
        amount: normalizeStoredAmount(payment.amount),
        method: String(payment.method || "Otro"),
        note: String(payment.note || ""),
        fromMarketing: Boolean(payment.fromMarketing)
      }))
      .filter((payment) => payment.amount > 0);
    const normalizedPayments = relocateFinanceDateLinkedPayments(
      {
        id,
        date: previousFinanceDate || financeDate,
        payments: normalizedPaymentsBeforeDateRepair
      },
      financeDate
    );
    const totalAmount = normalizeStoredAmount(entry.totalAmount);
    const storedPendingAmount = normalizeStoredAmount(entry.pendingAmount);
    const legacyPaidAmount = normalizeStoredAmount(entry.paidAmount);
    const hasStoredPaidAmount =
      entry.paidAmount !== undefined &&
      entry.paidAmount !== null &&
      String(entry.paidAmount).trim() !== "";
    const hasValidStoredPendingAmount =
      entry.pendingAmount !== undefined &&
      entry.pendingAmount !== null &&
      isValidStoredAmount(entry.pendingAmount) &&
      storedPendingAmount <= totalAmount;
    const inferredPaidAmount = hasValidStoredPendingAmount
      ? Math.max(totalAmount - storedPendingAmount, 0)
      : 0;
    const fallbackPaidAmount = hasStoredPaidAmount ? legacyPaidAmount : inferredPaidAmount;
    const usedPaymentIds = new Set(normalizedPayments.map((payment) => payment.id));
    const legacyPayments =
      normalizedPayments.length === 0
        ? createLegacyPayments({
            id,
            date: financeDate,
            paidAmount: fallbackPaidAmount,
            description: String(entry.description || "")
          }).map((payment) => ({
            ...payment,
            id: reserveUniqueId(payment.id, `${id}-legacy-payment`, usedPaymentIds)
          }))
        : [];
    const payments = normalizedPayments.length > 0 ? normalizedPayments : legacyPayments;

    return syncFinanceEntry({
      id,
      date: financeDate,
      concept: String(entry.concept || "Sin concepto"),
      practitioner: entry.practitioner ? String(entry.practitioner) : undefined,
      status: String(entry.status || ""),
      totalAmount,
      paidAmount: legacyPaidAmount,
      pendingAmount: storedPendingAmount,
      description: String(entry.description || ""),
      linkedTreatmentId,
      payments
    });
  });
  const orderedFinances = sortFinancesByActivity(finances);
  const pendingTotal = orderedFinances.reduce((sum, entry) => sum + Number(entry.pendingAmount || 0), 0);
  const currentPatientExpenses = normalizeFirebaseCollection<Record<string, unknown>>(
    rawPatient.patientExpenses,
    "patient-expense"
  );
  const legacyPatientExpenses = normalizeFirebaseCollection<Record<string, unknown>>(
    rawPatient.expenses,
    "legacy-patient-expense"
  );
  const usedExpenseIds = new Set<string>();
  const normalizedCurrentExpenses = currentPatientExpenses.map((expense, index) => {
    const id = reserveUniqueId(expense.id, `patient-expense-${index + 1}`, usedExpenseIds);
    const linkedTreatmentDate = expense.linkedTreatmentId
      ? treatmentDates.get(String(expense.linkedTreatmentId))
      : "";
    const normalizedExpense = normalizeExpense(
      id,
      expense,
      "patient",
      linkedTreatmentDate || fallbackDate
    );

    return linkedTreatmentDate
      ? { ...normalizedExpense, date: linkedTreatmentDate }
      : normalizedExpense;
  });
  const currentExpensesBySourceId = new Map(
    normalizedCurrentExpenses.map((expense) => [expense.id, expense])
  );
  const normalizedLegacyExpenses = legacyPatientExpenses.flatMap((expense, index) => {
    const sourceId = String(expense.id || `legacy-patient-expense-${index + 1}`);
    const linkedTreatmentDate = expense.linkedTreatmentId
      ? treatmentDates.get(String(expense.linkedTreatmentId))
      : "";
    const normalizedExpenseBeforeDateRepair = normalizeExpense(
      sourceId,
      expense,
      "patient",
      linkedTreatmentDate || fallbackDate
    );
    const normalizedExpense = linkedTreatmentDate
      ? { ...normalizedExpenseBeforeDateRepair, date: linkedTreatmentDate }
      : normalizedExpenseBeforeDateRepair;
    const currentCopy = currentExpensesBySourceId.get(sourceId);

    if (currentCopy && areEquivalentExpenses(currentCopy, normalizedExpense)) return [];

    return [
      {
        ...normalizedExpense,
        id: reserveUniqueId(sourceId, `legacy-patient-expense-${index + 1}`, usedExpenseIds)
      }
    ];
  });
  const patientExpenses = [...normalizedCurrentExpenses, ...normalizedLegacyExpenses];
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
    createdAt: fallbackDate,
    birthDate: String(rawPatient.birthDate || ""),
    lastVisit: rawPatient.lastVisit
      ? (parseStoredDate(rawPatient.lastVisit) ?? fallbackDate) || null
      : null,
    financeTone: inferFinanceTone(String(rawPatient.financeTone || rawPatient.financeStatus || ""), pendingTotal),
    occupation: String(rawPatient.occupation || ""),
    city: String(rawPatient.city || ""),
    tags: Array.isArray(rawPatient.tags) ? rawPatient.tags.map(String) : [],
    clinicalSummary: String(rawPatient.clinicalSummary || ""),
    treatments,
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

type Identifiable = { id: string };

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }

  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key]))
    );
  }

  return false;
}

function mergeObjectFields<T extends object>(previous: T | undefined, next: T, server: T | undefined): T {
  if (!server) return next;

  const previousRecord = (previous ?? {}) as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const mergedRecord = { ...(server as Record<string, unknown>) };

  for (const [key, nextValue] of Object.entries(nextRecord)) {
    if (!previous || !hasOwn(previousRecord, key) || !valuesEqual(nextValue, previousRecord[key])) {
      mergedRecord[key] = nextValue;
    }
  }

  if (previous) {
    for (const key of Object.keys(previousRecord)) {
      if (!hasOwn(nextRecord, key)) delete mergedRecord[key];
    }
  }

  return mergedRecord as T;
}

function mergeCollectionById<T extends Identifiable>(
  previousItems: T[],
  nextItems: T[],
  serverItems: T[],
  mergeItem: (previous: T | undefined, next: T, server: T | undefined) => T = mergeObjectFields
): T[] {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  const serverById = new Map(serverItems.map((item) => [item.id, item]));
  const orderedIds = [
    ...nextItems.map((item) => item.id),
    ...serverItems.map((item) => item.id).filter((id) => !nextById.has(id))
  ];

  return orderedIds.flatMap((id) => {
    const previousItem = previousById.get(id);
    const nextItem = nextById.get(id);
    const serverItem = serverById.get(id);

    // It existed before and no longer exists locally: this is an intentional deletion.
    if (previousItem && !nextItem) return [];

    // It only exists on the server: preserve a concurrent addition.
    if (!nextItem && serverItem) return [serverItem];
    if (!nextItem) return [];

    // If another client deleted an unchanged item, keep that server-side deletion.
    if (previousItem && !serverItem && valuesEqual(previousItem, nextItem)) return [];

    return [mergeItem(previousItem, nextItem, serverItem)];
  });
}

function mergeFinanceEntry(
  previous: Patient["finances"][number] | undefined,
  next: Patient["finances"][number],
  server: Patient["finances"][number] | undefined
): Patient["finances"][number] {
  const merged = mergeObjectFields(previous, next, server);
  const synced = syncFinanceEntry({
    ...merged,
    payments: mergeCollectionById(previous?.payments ?? [], next.payments, server?.payments ?? [])
  });
  const serverOverage = server ? Math.max(server.paidAmount - server.totalAmount, 0) : 0;
  const mergedOverage = Math.max(synced.paidAmount - synced.totalAmount, 0);

  if (mergedOverage > serverOverage) {
    throw new Error(
      `Conflicto de cobros en "${synced.concept}": los pagos concurrentes superan el total registrado.`
    );
  }

  return synced;
}

function mergeBudgetEntry(
  previous: Patient["budgets"][number] | undefined,
  next: Patient["budgets"][number],
  server: Patient["budgets"][number] | undefined
): Patient["budgets"][number] {
  return {
    ...mergeObjectFields(previous, next, server),
    items: mergeCollectionById(previous?.items ?? [], next.items, server?.items ?? [])
  };
}

function deriveFinanceTone(finances: Patient["finances"]): FinanceTone {
  if (finances.length === 0) return "review";

  const pendingAmount = finances.reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const paidAmount = finances.reduce((sum, entry) => sum + entry.paidAmount, 0);
  if (pendingAmount === 0) return "balanced";
  if (paidAmount > 0) return "partial";
  return "pending";
}

function syncTreatmentsFromFinances(
  treatments: Patient["treatments"],
  finances: Patient["finances"]
): Patient["treatments"] {
  return [...treatments]
    .map((treatment) => {
      const linkedFinance = finances.find(
        (entry) => entry.id === treatment.linkedFinanceId || entry.linkedTreatmentId === treatment.id
      );
      if (!linkedFinance) return treatment;

      return {
        ...treatment,
        totalAmount: linkedFinance.totalAmount,
        paidAmount: linkedFinance.paidAmount,
        pendingAmount: linkedFinance.pendingAmount
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

/**
 * Applies a local patient change over the latest server snapshot. Collections are
 * merged by stable IDs so two saves made from the same original patient do not
 * overwrite independent records. Local removals are kept as intentional deletes.
 */
export function mergePatientChanges(previous: Patient, next: Patient, server: Patient): Patient {
  const merged = mergeObjectFields(previous, next, server);
  const finances = sortFinancesByActivity(
    mergeCollectionById(previous.finances, next.finances, server.finances, mergeFinanceEntry)
  );
  const treatments = syncTreatmentsFromFinances(
    mergeCollectionById(previous.treatments, next.treatments, server.treatments),
    finances
  );

  return {
    ...merged,
    lastVisit: treatments[0]?.date ?? merged.lastVisit ?? null,
    financeTone: deriveFinanceTone(finances),
    treatments,
    evolutions: mergeCollectionById(previous.evolutions, next.evolutions, server.evolutions),
    followUps: mergeCollectionById(previous.followUps, next.followUps, server.followUps),
    notes: mergeCollectionById(previous.notes, next.notes, server.notes),
    budgets: mergeCollectionById(previous.budgets, next.budgets, server.budgets, mergeBudgetEntry),
    finances,
    patientExpenses: mergeCollectionById(
      previous.patientExpenses,
      next.patientExpenses,
      server.patientExpenses
    )
  };
}

export function resolvePatientTransactionValue(
  patient: Patient,
  previousPatient: Patient | undefined,
  currentValue: unknown
): Omit<Patient, "id"> {
  if (!previousPatient) return serializePatient(patient);

  if (!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue)) {
    throw new Error("La ficha del paciente fue eliminada mientras se guardaban los cambios.");
  }

  const serverPatient = normalizePatient(patient.id, currentValue as Record<string, unknown>);
  return serializePatient(mergePatientChanges(previousPatient, patient, serverPatient));
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

export async function savePatient(patient: Patient, previousPatient?: Patient) {
  const database = ensureDatabase();
  const patientRef = ref(database, `odontologia/pacientes/${patient.id}`);

  if (previousPatient) {
    const existingSnapshot = await get(patientRef);
    if (!existingSnapshot.exists()) {
      throw new Error("La ficha del paciente fue eliminada mientras se guardaban los cambios.");
    }
  }

  await runTransaction(patientRef, (currentValue) =>
    resolvePatientTransactionValue(patient, previousPatient, currentValue)
  );
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
