import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import logoWhite from "../zzzalewhite.png";
import { AlertBoard } from "./components/AlertBoard";
import { AttentionModal, type AttentionFormValues } from "./components/AttentionModal";
import { AuthScreen } from "./components/AuthScreen";
import { BudgetModal, type BudgetFormValues } from "./components/BudgetModal";
import { BudgetPrintPreview } from "./components/BudgetPrintPreview";
import { ConfirmModal } from "./components/ConfirmModal";
import { EntityModal, type ModalField } from "./components/EntityModal";
import { MarketingDashboard } from "./components/MarketingDashboard";
import { MetricCard } from "./components/MetricCard";
import { PatientRoster } from "./components/PatientRoster";
import { PatientWorkspace, type RecordKind } from "./components/PatientWorkspace";
import { PeriodFinancials } from "./components/PeriodFinancials";
import { useClinicData } from "./hooks/useClinicData";
import { useFirebaseSession } from "./hooks/useFirebaseSession";
import {
  deleteExpense as deleteExpenseRecord,
  deletePatient as deletePatientRecord,
  hasRealtimeDatabaseConfig,
  saveExpense as saveGeneralExpense,
  savePatient,
  subscribeServerTimeOffset
} from "./lib/firebase";
import {
  createBudgetItem,
  createBudgetNumber,
  sortBudgetsByDateDesc,
  syncBudgetEntry
} from "./lib/budgets";
import {
  appendPaymentToFinance,
  createFinanceEntry,
  createPaymentEntry,
  describeFinanceStatus,
  sortFinancesByActivity,
  syncFinanceEntry
} from "./lib/financeEntries";
import {
  getClinicAlerts,
  getCollectedIncomeEntries,
  getDashboardMetrics,
  getPendingCollections,
  getPeriodExpenses
} from "./lib/dashboard";
import {
  formatGs,
  formatMonthRangeLabel,
  getParaguayPhoneSearchTerms,
  getMonthKey,
  normalizeMonthRange,
  normalizeParaguayPhone
} from "./lib/date";
import { getMarketingDashboardData } from "./lib/marketing";
import {
  getPractitionerKey,
  getUniquePractitionerNames,
  normalizePatientPractitioners,
  normalizePractitionerName
} from "./lib/practitioners";
import { clinicProfile } from "./lib/clinicProfile";
import {
  getAutoFollowUpDateForType,
  getSuggestedFollowUpFromAttention
} from "./lib/followUpRules";
import type {
  AlertFilter,
  BudgetEntry,
  Expense,
  EvolutionEntry,
  FinanceEntry,
  FinanceTone,
  FollowUp,
  NoteEntry,
  PaymentEntry,
  Patient,
  Treatment
} from "./types/clinic";

type MainView = "home" | "patients" | "alerts" | "finance" | "marketing";
type PatientLetterFilter = "all" | string;
type DoctorFilter = "all" | string;
type SyncState = "idle" | "saving" | "saved" | "error";

type ModalState =
  | { type: "patient-create" }
  | { type: "patient-edit"; patientId: string }
  | { type: "marketing-expense-create" }
  | { type: "marketing-expense-edit"; expenseId: string }
  | { type: "record-create"; kind: RecordKind; patientId?: string; prefillFromId?: string }
  | { type: "record-edit"; kind: RecordKind; patientId: string; itemId: string }
  | { type: "budget-preview"; patientId: string; budgetId: string }
  | null;

type DeleteIntent =
  | { target: "patient"; patientId: string }
  | { target: "marketing-expense"; expenseId: string }
  | { target: RecordKind; patientId: string; itemId: string }
  | null;

function getPatientInitial(patientName: string) {
  const firstChar = patientName.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function filterPatients(
  patients: Patient[],
  searchTerm: string,
  activeLetter: PatientLetterFilter,
  activeDoctor: DoctorFilter
) {
  const normalized = searchTerm.trim().toLowerCase();
  const activeDoctorKey = getPractitionerKey(activeDoctor);

  return [...patients]
    .filter((patient) => {
      const matchesLetter = activeLetter === "all" ? true : getPatientInitial(patient.fullName) === activeLetter;
      if (!matchesLetter) return false;

      const matchesDoctor =
        activeDoctor === "all"
          ? true
          : patient.treatments.some((treatment) => getPractitionerKey(treatment.practitioner) === activeDoctorKey);
      if (!matchesDoctor) return false;

      if (!normalized) return true;

      const phoneSearchText = getParaguayPhoneSearchTerms(patient.phone).join(" ");
      const searchable = `${patient.fullName} ${patient.phone} ${patient.treatments
        .map((treatment) => treatment.practitioner)
        .join(" ")} ${phoneSearchText}`.toLowerCase();

      return searchable.includes(normalized);
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey(referenceDate = new Date()) {
  return getMonthKey(referenceDate);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toAmount(value?: string | null) {
  const normalized = (value ?? "").replace(/[^\d]/g, "");
  return normalized ? Number(normalized) : 0;
}

function sortByDateDesc<T extends { date: string }>(items: T[]) {
  return [...items].sort((left, right) => right.date.localeCompare(left.date));
}

function sortFollowUps(items: FollowUp[]) {
  return [...items].sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

function deriveFinanceTone(finances: FinanceEntry[]): FinanceTone {
  if (finances.length === 0) return "review";
  const pendingAmount = finances.reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const paidAmount = finances.reduce((sum, entry) => sum + entry.paidAmount, 0);
  if (pendingAmount === 0) return "balanced";
  if (paidAmount > 0) return "partial";
  return "pending";
}

function applyDerivedFields(patient: Patient): Patient {
  const latestTreatment = sortByDateDesc(patient.treatments)[0] ?? null;
  return {
    ...patient,
    lastVisit: latestTreatment?.date ?? patient.lastVisit ?? null,
    financeTone: deriveFinanceTone(patient.finances)
  };
}

function preparePatients(patients: Patient[]) {
  return patients.map((patient) => applyDerivedFields(normalizePatientPractitioners(patient)));
}

function syncTreatmentWithFinance(treatment: Treatment, finance: FinanceEntry | null | undefined): Treatment {
  if (!finance) return treatment;

  return {
    ...treatment,
    totalAmount: finance.totalAmount,
    paidAmount: finance.paidAmount,
    pendingAmount: finance.pendingAmount
  };
}

function syncTreatmentsFromFinances(treatments: Treatment[], finances: FinanceEntry[]) {
  return sortByDateDesc(
    treatments.map((treatment) => {
      const linkedFinance =
        finances.find(
          (entry) => entry.id === treatment.linkedFinanceId || entry.linkedTreatmentId === treatment.id
        ) ?? null;

      return syncTreatmentWithFinance(treatment, linkedFinance);
    })
  );
}

function buildTreatmentFinanceEntry(
  treatmentId: string,
  values: Record<string, string>,
  existingFinance?: FinanceEntry
): FinanceEntry {
  const totalAmount = toAmount(values.totalAmount);
  const practitioner = normalizePractitionerName(values.practitioner);
  const currentPayments = existingFinance?.payments ?? [];
  const existingPaidAmount = currentPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const createPaymentDelta = !existingFinance
    ? Math.min(toAmount(values.paidAmount), totalAmount)
    : 0;
  const payments =
    createPaymentDelta > 0
      ? [
          createPaymentEntry({
            id: createId("payment"),
            date: values.date || todayKey(),
            amount: createPaymentDelta,
            method: "Efectivo",
            note: "Pago registrado junto con la atencion.",
            fromMarketing: values.paidFromMarketing === "true"
          }),
          ...currentPayments
        ]
      : currentPayments;

  return syncFinanceEntry({
    id: existingFinance?.id ?? createId("finance"),
    date: values.date || todayKey(),
    concept: values.detail.trim(),
    practitioner,
    totalAmount,
    status: describeFinanceStatus(totalAmount, Math.min(existingPaidAmount + createPaymentDelta, totalAmount)),
    paidAmount: Math.min(existingPaidAmount + createPaymentDelta, totalAmount),
    pendingAmount: Math.max(totalAmount - Math.min(existingPaidAmount + createPaymentDelta, totalAmount), 0),
    description: values.note.trim(),
    linkedTreatmentId: treatmentId,
    payments
  });
}

function summarizeAttentionItems(items: AttentionFormValues["items"]) {
  const labels = items.map((item) => item.detail.trim()).filter(Boolean);
  if (labels.length === 0) return "Atencion clinica";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels[0]} y ${labels.length - 1} tratamiento(s) mas`;
}

function buildAttentionPayload(values: AttentionFormValues) {
  const cleanItems = values.items.filter((item) => item.detail.trim());
  const referenceDate = values.date || todayKey();
  const practitioner = normalizePractitionerName(values.practitioner);
  const note = values.note.trim();
  const treatments: Treatment[] = [];
  const finances: FinanceEntry[] = [];
  const patientExpenses: Expense[] = [];

  cleanItems.forEach((item) => {
    const treatmentId = createId("treatment");
    const financeId = createId("finance");
    const totalAmount = toAmount(item.totalAmount);
    const paidTodayAmount = Math.min(toAmount(item.paidAmount), totalAmount);
    const costAmount = toAmount(item.costAmount);
    const linkedFinance = createFinanceEntry({
      id: financeId,
      date: referenceDate,
      concept: item.detail.trim(),
      practitioner,
      totalAmount,
      description: note,
      linkedTreatmentId: treatmentId,
      payments:
        paidTodayAmount > 0
          ? [
              createPaymentEntry({
                id: createId("payment"),
                date: referenceDate,
                amount: paidTodayAmount,
                method: "Efectivo",
                note: "Pago registrado junto con la atencion.",
                fromMarketing: item.paidFromMarketing
              })
            ]
          : []
    });

    treatments.push({
      id: treatmentId,
      date: referenceDate,
      category: item.category.trim() || "Consulta",
      detail: item.detail.trim(),
      practitioner,
      status: item.status,
      totalAmount,
      paidAmount: linkedFinance.paidAmount,
      pendingAmount: linkedFinance.pendingAmount,
      note,
      linkedFinanceId: financeId
    });

    finances.push(linkedFinance);

    if (costAmount > 0) {
      patientExpenses.push({
        id: createId("patient-expense"),
        date: referenceDate,
        concept: item.detail.trim(),
        category: item.costCategory.trim() || "Laboratorio",
        amount: costAmount,
        description: note || "Costo registrado junto con la atencion.",
        scope: "patient",
        linkedTreatmentId: treatmentId
      });
    }
  });

  const followUps: FollowUp[] =
    values.scheduleFollowUp && values.followUpDueDate
      ? [
          {
            id: createId("followup"),
            eventDate: referenceDate,
            dueDate: values.followUpDueDate,
            type: values.followUpType.trim() || "Control general",
            source: summarizeAttentionItems(cleanItems),
            status: "Pendiente",
            notes: values.followUpNotes.trim() || note
          }
        ]
      : [];

  return {
    cleanItems,
    referenceDate,
    treatments,
    finances,
    patientExpenses,
    followUps
  };
}

function getAttentionSuccessMessage(treatmentsCount: number, createdPatient: boolean, hasFollowUp: boolean) {
  const baseMessage = createdPatient
    ? treatmentsCount === 1
      ? "Paciente nuevo y atencion guardados."
      : `Paciente nuevo y ${treatmentsCount} tratamientos guardados.`
    : treatmentsCount === 1
      ? "Atencion guardada."
      : `${treatmentsCount} tratamientos guardados.`;

  return hasFollowUp ? `${baseMessage} Control programado.` : baseMessage;
}

function createBudgetLineFormItem(quantity = "1", detail = "", unitPrice = ""): BudgetFormValues["items"][number] {
  return {
    id: createId("budget-item"),
    quantity,
    detail,
    unitPrice
  };
}

function buildBudgetEntryFromForm(values: BudgetFormValues, budgetId?: string, existingBudgetNumber?: string): BudgetEntry {
  const createdAt = values.createdAt || todayKey();
  const validityDays = values.validityDays === "30" ? 30 : 15;
  const rawItems = values.items
    .map((item) =>
      createBudgetItem(
        item.id || createId("budget-item"),
        Math.max(toAmount(item.quantity), 0),
        item.detail.trim(),
        Math.max(toAmount(item.unitPrice), 0)
      )
    )
    .filter((item) => item.detail.trim());
  const entryId = budgetId ?? createId("budget");

  return syncBudgetEntry({
    id: entryId,
    budgetNumber: existingBudgetNumber ?? createBudgetNumber(createdAt, entryId),
    status: values.status,
    createdAt,
    validityDays,
    validUntil: values.validUntil,
    note: values.note.trim(),
    items: rawItems,
    totalAmount: 0
  });
}

function defaultPatientValues(patient?: Patient) {
  return {
    fullName: patient?.fullName ?? "",
    phone: patient?.phone ?? "",
    birthDate: patient?.birthDate ?? "",
    occupation: patient?.occupation ?? "",
    city: patient?.city ?? "",
    tags: patient?.tags.join(", ") ?? "",
    clinicalSummary: patient?.clinicalSummary ?? ""
  };
}

function patientFields(): ModalField[] {
  return [
    { name: "fullName", label: "Nombre y apellido", type: "text", required: true, placeholder: "Ej.: Juan Perez" },
    { name: "phone", label: "Telefono", type: "tel", required: true, placeholder: "Ej.: 0981885999" },
    { name: "birthDate", label: "Fecha de nacimiento", type: "date" },
    { name: "occupation", label: "Ocupacion", type: "text", placeholder: "Ej.: Arquitecta" },
    { name: "city", label: "Ciudad", type: "text", placeholder: "Ej.: Asuncion" },
    { name: "tags", label: "Etiquetas", type: "text", placeholder: "Periodoncia, Control, WhatsApp" },
    {
      name: "clinicalSummary",
      label: "Resumen clinico",
      type: "textarea",
      placeholder: "Resumen rapido del estado del paciente",
      rows: 5
    }
  ];
}

function marketingExpenseFields(): ModalField[] {
  return [
    { name: "date", label: "Fecha", type: "date", required: true },
    { name: "concept", label: "Concepto", type: "text", required: true, placeholder: "Ej.: Campana Instagram junio" },
    { name: "vendor", label: "Proveedor", type: "text", placeholder: "Ej.: Agencia Atlas, Meta Ads" },
    {
      name: "marketingType",
      label: "Tipo de gasto",
      type: "select",
      options: ["Agencia", "Publicidad", "Contenido", "Diseno", "Otro"]
    },
    {
      name: "paymentMethod",
      label: "Forma de pago",
      type: "select",
      options: ["Transferencia", "Tarjeta", "Efectivo", "QR", "Otro"]
    },
    { name: "amount", label: "Monto", type: "number", min: 0, step: "1", required: true },
    { name: "description", label: "Detalle", type: "textarea", rows: 4, placeholder: "Notas del gasto o de la campana" }
  ];
}

function defaultMarketingExpenseValues(expense?: Expense) {
  return {
    date: expense?.date ?? todayKey(),
    concept: expense?.concept ?? "",
    vendor: expense?.vendor ?? "",
    marketingType: expense?.marketingType ?? "Publicidad",
    paymentMethod: expense?.paymentMethod ?? "Transferencia",
    amount: expense ? String(expense.amount) : "",
    description: expense?.description ?? ""
  };
}

export default function App() {
  const { sessionState, userEmail, authError, isSubmitting, login, logout } = useFirebaseSession();
  const { patients: sourcePatients, expenses: sourceExpenses } = useClinicData(
    sessionState === "authenticated"
  );
  const [clinicPatients, setClinicPatients] = useState<Patient[]>(() => preparePatients(sourcePatients));
  const [clinicExpenses, setClinicExpenses] = useState<Expense[]>(() => sourceExpenses);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [timeRefreshToken, setTimeRefreshToken] = useState(() => Date.now());
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(() => currentMonthKey());
  const [periodStartMonth, setPeriodStartMonth] = useState(() => currentMonthKey());
  const [periodEndMonth, setPeriodEndMonth] = useState(() => currentMonthKey());
  const [isPeriodAuto, setIsPeriodAuto] = useState(true);
  const [showPeriodPanel, setShowPeriodPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activePatientLetter, setActivePatientLetter] = useState<PatientLetterFilter>("all");
  const [activeDoctorFilter, setActiveDoctorFilter] = useState<DoctorFilter>("all");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [activeAlertFilter, setActiveAlertFilter] = useState<AlertFilter>("all");
  const [activeView, setActiveView] = useState<MainView>("home");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent>(null);
  const [loginEmail, setLoginEmail] = useState<string>(clinicProfile.loginEmail);
  const [loginPassword, setLoginPassword] = useState("");
  const [manualAuthError, setManualAuthError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const periodPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setClinicPatients(preparePatients(sourcePatients));
  }, [sourcePatients]);

  useEffect(() => {
    setClinicExpenses(sourceExpenses);
  }, [sourceExpenses]);

  useEffect(() => {
    if (sessionState !== "authenticated" || !hasRealtimeDatabaseConfig()) {
      setServerTimeOffsetMs(0);
      return undefined;
    }

    return subscribeServerTimeOffset(
      (offsetMs) => setServerTimeOffsetMs(offsetMs),
      (error) => {
        console.error("No se pudo leer la hora de referencia del sistema", error);
        setServerTimeOffsetMs(0);
      }
    );
  }, [sessionState]);

  useEffect(() => {
    const refreshClock = () => setTimeRefreshToken(Date.now());
    const intervalId = window.setInterval(refreshClock, 60000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        refreshClock();
      }
    };

    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, []);

  const referenceNow = useMemo(
    () => new Date(timeRefreshToken + serverTimeOffsetMs),
    [serverTimeOffsetMs, timeRefreshToken]
  );

  useEffect(() => {
    if (sessionState === "authenticated") {
      setManualAuthError(null);
      setLoginPassword("");
    }
  }, [sessionState]);

  useEffect(() => {
    if (syncState !== "saved") return undefined;

    const timeoutId = window.setTimeout(() => {
      setSyncState("idle");
      setSyncMessage("");
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [syncState]);

  useEffect(() => {
    if (!showPeriodPanel) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!periodPickerRef.current?.contains(event.target as Node)) {
        setShowPeriodPanel(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showPeriodPanel]);

  useEffect(() => {
    const nextMonth = currentMonthKey(referenceNow);
    setCurrentCalendarMonth((currentMonth) => (currentMonth === nextMonth ? currentMonth : nextMonth));
  }, [referenceNow]);

  useEffect(() => {
    if (!isPeriodAuto) return;

    setPeriodStartMonth(currentCalendarMonth);
    setPeriodEndMonth(currentCalendarMonth);
  }, [currentCalendarMonth, isPeriodAuto]);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const filteredPatients = filterPatients(
    clinicPatients,
    deferredSearchTerm,
    activePatientLetter,
    activeDoctorFilter
  );

  useEffect(() => {
    if (filteredPatients.length === 0) {
      setSelectedPatientId(null);
      return;
    }

    const stillExists = filteredPatients.some((patient) => patient.id === selectedPatientId);
    if (!stillExists) {
      setSelectedPatientId(null);
    }
  }, [filteredPatients, selectedPatientId]);

  const periodRange = useMemo(() => normalizeMonthRange(periodStartMonth, periodEndMonth), [periodEndMonth, periodStartMonth]);
  const periodLabel = useMemo(() => formatMonthRangeLabel(periodRange), [periodRange]);
  const selectedPatient = filteredPatients.find((patient) => patient.id === selectedPatientId) ?? null;
  const alerts = getClinicAlerts(clinicPatients, referenceNow);
  const metrics = getDashboardMetrics(clinicPatients, clinicExpenses, periodRange);
  const pendingCollections = getPendingCollections(clinicPatients, periodRange);
  const collectedEntries = getCollectedIncomeEntries(clinicPatients, periodRange);
  const periodExpenses = getPeriodExpenses(clinicPatients, clinicExpenses, periodRange);
  const marketingData = getMarketingDashboardData(clinicPatients, clinicExpenses, periodRange);
  const activeAlertsCount = alerts.length;
  const urgentAlertsCount = alerts.filter((alert) => alert.bucket === "vencido" || alert.bucket === "today").length;

  const patientOptions = useMemo(
    () =>
      [...clinicPatients]
        .sort((left, right) => left.fullName.localeCompare(right.fullName))
        .map((patient) => ({ value: patient.id, label: `${patient.fullName} - ${patient.phone}` })),
    [clinicPatients]
  );

  const availablePatientLetters = useMemo(
    () =>
      Array.from(new Set(clinicPatients.map((patient) => getPatientInitial(patient.fullName)))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [clinicPatients]
  );

  const availableDoctors = useMemo(
    () =>
      getUniquePractitionerNames(
        clinicPatients.flatMap((patient) => [
          ...patient.treatments.map((treatment) => treatment.practitioner),
          ...patient.finances.map((entry) => entry.practitioner ?? "")
        ])
      ),
    [clinicPatients]
  );

  useEffect(() => {
    if (activeDoctorFilter === "all") return;

    const matchingDoctor = availableDoctors.find(
      (doctor) => getPractitionerKey(doctor) === getPractitionerKey(activeDoctorFilter)
    );

    if (!matchingDoctor) {
      setActiveDoctorFilter("all");
      return;
    }

    if (matchingDoctor !== activeDoctorFilter) {
      setActiveDoctorFilter(matchingDoctor);
    }
  }, [activeDoctorFilter, availableDoctors]);

  const persistFirebaseChange = async (
    operation: () => Promise<void>,
    successMessage: string,
    onRollback?: () => void
  ) => {
    if (!hasRealtimeDatabaseConfig()) {
      setSyncState("error");
      setSyncMessage("Falta completar la configuracion del sistema.");
      onRollback?.();
      return;
    }

    setSyncState("saving");
    setSyncMessage("Guardando cambios...");

    try {
      await operation();
      setSyncState("saved");
      setSyncMessage(successMessage);
    } catch (error) {
      console.error("No se pudo guardar el cambio", error);
      onRollback?.();
      setSyncState("error");
      setSyncMessage("No se pudo guardar el cambio.");
    }
  };

  const applyPatientMutation = (
    patientId: string,
    updater: (patient: Patient) => Patient,
    successMessage: string
  ) => {
    const previousPatients = clinicPatients;
    const currentPatient = previousPatients.find((patient) => patient.id === patientId);
    if (!currentPatient) return;

    const nextPatient = applyDerivedFields(updater(currentPatient));
    const nextPatients = previousPatients.map((patient) => (patient.id === patientId ? nextPatient : patient));

    setClinicPatients(nextPatients);
    void persistFirebaseChange(() => savePatient(nextPatient), successMessage, () => setClinicPatients(previousPatients));
  };

  const applyExpenseMutation = (
    nextExpense: Expense,
    successMessage: string,
    expenseId?: string
  ) => {
    const previousExpenses = clinicExpenses;
    const nextExpenses = sortByDateDesc(
      expenseId
        ? previousExpenses.map((expense) => (expense.id === expenseId ? nextExpense : expense))
        : [nextExpense, ...previousExpenses]
    );

    setClinicExpenses(nextExpenses);
    void persistFirebaseChange(() => saveGeneralExpense(nextExpense), successMessage, () => setClinicExpenses(previousExpenses));
  };

  const handleOpenPatient = (patientId: string) => {
    startTransition(() => {
      setSearchTerm("");
      setActivePatientLetter("all");
      setActiveDoctorFilter("all");
      setActiveView("patients");
      setSelectedPatientId(patientId);
    });
  };

  const closePatientSheet = () => {
    setSelectedPatientId(null);
  };

  const openPatientCreate = () => {
    setModalState({ type: "patient-create" });
  };

  const openTreatmentCreate = () => {
    setModalState({ type: "record-create", kind: "treatment" });
  };

  const openBudgetCreate = () => {
    if (clinicPatients.length === 0) {
      openPatientCreate();
      return;
    }

    setModalState({ type: "record-create", kind: "budget" });
  };

  const openBudgetDuplicate = (patientId: string, budgetId: string) => {
    setModalState({ type: "record-create", kind: "budget", patientId, prefillFromId: budgetId });
  };

  const openMarketingExpenseCreate = () => {
    setModalState({ type: "marketing-expense-create" });
  };

  const openMarketingExpenseEdit = (expenseId: string) => {
    setModalState({ type: "marketing-expense-edit", expenseId });
  };

  const askDeleteMarketingExpense = (expenseId: string) => {
    setDeleteIntent({ target: "marketing-expense", expenseId });
  };

  const openCreateRecord = (kind: RecordKind, patientId: string) => {
    setModalState({ type: "record-create", kind, patientId });
  };

  const openEditRecord = (kind: RecordKind, patientId: string, itemId: string) => {
    setModalState({ type: "record-edit", kind, patientId, itemId });
  };

  const askDeleteRecord = (kind: RecordKind, patientId: string, itemId: string) => {
    setDeleteIntent({ target: kind, patientId, itemId });
  };

  const askDeletePatient = (patientId: string) => {
    setDeleteIntent({ target: "patient", patientId });
  };

  const openBudgetPreview = (patientId: string, budgetId: string) => {
    setModalState({ type: "budget-preview", patientId, budgetId });
  };

  const closeModals = () => {
    setModalState(null);
    setDeleteIntent(null);
  };

  const handleLoginSubmit = () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setManualAuthError("Completa el email y la contrasena para ingresar.");
      return;
    }

    setManualAuthError(null);
    void login(loginEmail.trim(), loginPassword);
  };

  const handleLogout = () => {
    void logout();
  };

  const submitPatientForm = (values: Record<string, string>, patientId?: string) => {
    const previousPatients = clinicPatients;
    const previousSelectedPatientId = selectedPatientId;
    const previousView = activeView;
    const existingPatient = patientId ? clinicPatients.find((patient) => patient.id === patientId) ?? null : null;

    const basePatient: Patient = {
      id: patientId ?? createId("patient"),
      fullName: values.fullName.trim(),
      phone: normalizeParaguayPhone(values.phone),
      createdAt: existingPatient?.createdAt ?? todayKey(),
      birthDate: values.birthDate || "",
      lastVisit: existingPatient?.lastVisit ?? null,
      financeTone: existingPatient?.financeTone ?? "review",
      occupation: values.occupation.trim(),
      city: values.city.trim(),
      tags: parseTags(values.tags),
      clinicalSummary: values.clinicalSummary.trim(),
      treatments: existingPatient?.treatments ?? [],
      evolutions: existingPatient?.evolutions ?? [],
      followUps: existingPatient?.followUps ?? [],
      notes: existingPatient?.notes ?? [],
      budgets: existingPatient?.budgets ?? [],
      finances: existingPatient?.finances ?? [],
      patientExpenses: existingPatient?.patientExpenses ?? []
    };

    const normalized = applyDerivedFields(basePatient);
    const nextPatients = patientId
      ? previousPatients.map((patient) => (patient.id === patientId ? normalized : patient))
      : [normalized, ...previousPatients];

    setClinicPatients(nextPatients);
    setSearchTerm("");
    setActivePatientLetter("all");
    setActiveDoctorFilter("all");
    setSelectedPatientId(normalized.id);
    setActiveView("patients");
    closeModals();

    void persistFirebaseChange(
      () => savePatient(normalized),
      patientId ? "Ficha actualizada." : "Paciente creado.",
      () => {
        setClinicPatients(previousPatients);
        setSelectedPatientId(previousSelectedPatientId);
        setActiveView(previousView);
      }
    );
  };

  const submitMarketingExpenseForm = (values: Record<string, string>, expenseId?: string) => {
    const nextExpense: Expense = {
      id: expenseId ?? createId("marketing-expense"),
      date: values.date || todayKey(),
      concept: values.concept.trim(),
      category: "Marketing",
      amount: toAmount(values.amount),
      description: values.description.trim(),
      scope: "general",
      paymentMethod: values.paymentMethod.trim() || "Transferencia",
      vendor: values.vendor.trim(),
      marketingType: values.marketingType.trim() || "Publicidad",
      isMarketing: true
    };

    applyExpenseMutation(
      nextExpense,
      expenseId ? "Gasto de marketing actualizado." : "Gasto de marketing guardado.",
      expenseId
    );
    setActiveView("marketing");
    closeModals();
  };

  const submitAttentionForm = (values: AttentionFormValues, modalPatientId?: string) => {
    const targetPatientId = modalPatientId ?? values.patientTarget;
    const { cleanItems, referenceDate, treatments, finances, patientExpenses, followUps } = buildAttentionPayload(values);
    if (cleanItems.length === 0) return;

    const successMessage = getAttentionSuccessMessage(
      cleanItems.length,
      !targetPatientId,
      followUps.length > 0
    );

    if (!targetPatientId) {
      const quickName = values.quickPatientName.trim();
      if (!quickName) return;

      const previousPatients = clinicPatients;
      const previousSelectedPatientId = selectedPatientId;
      const previousView = activeView;

      const nextPatient = applyDerivedFields(
        normalizePatientPractitioners({
          id: createId("patient"),
          fullName: quickName,
          phone: normalizeParaguayPhone(values.quickPatientPhone),
          createdAt: referenceDate,
          birthDate: "",
          lastVisit: null,
          financeTone: "review",
          occupation: "",
          city: "",
          tags: [],
          clinicalSummary: "",
          treatments: sortByDateDesc(treatments),
          evolutions: [],
          followUps: sortFollowUps(followUps),
          notes: [],
          budgets: [],
          finances: sortFinancesByActivity(finances),
          patientExpenses: sortByDateDesc(patientExpenses)
        })
      );

      setClinicPatients([nextPatient, ...previousPatients]);
      setSearchTerm("");
      setActivePatientLetter("all");
      setActiveDoctorFilter("all");
      setSelectedPatientId(nextPatient.id);
      setActiveView("patients");
      closeModals();

      void persistFirebaseChange(
        () => savePatient(nextPatient),
        successMessage,
        () => {
          setClinicPatients(previousPatients);
          setSelectedPatientId(previousSelectedPatientId);
          setActiveView(previousView);
        }
      );
      return;
    }

    applyPatientMutation(
      targetPatientId,
      (patient) => ({
        ...patient,
        treatments: sortByDateDesc([...treatments, ...patient.treatments]),
        finances: sortFinancesByActivity([...finances, ...patient.finances]),
        patientExpenses: sortByDateDesc([...patientExpenses, ...patient.patientExpenses]),
        followUps: sortFollowUps([...followUps, ...patient.followUps])
      }),
      successMessage
    );

    setSelectedPatientId(targetPatientId);
    setActiveView("patients");
    closeModals();
  };

  const submitBudgetForm = (values: BudgetFormValues, intent: "save" | "print", budgetId?: string) => {
    const targetPatientId = values.patientTarget;
    if (!targetPatientId) return;

    const currentPatient = clinicPatients.find((patient) => patient.id === targetPatientId) ?? null;
    if (!currentPatient) return;

    const existingBudget = budgetId ? currentPatient.budgets.find((item) => item.id === budgetId) ?? null : null;
    const nextBudget = buildBudgetEntryFromForm(values, budgetId, existingBudget?.budgetNumber);
    if (nextBudget.items.length === 0) return;

    applyPatientMutation(
      targetPatientId,
      (patient) => ({
        ...patient,
        budgets: sortBudgetsByDateDesc(
          budgetId
            ? patient.budgets.map((item) => (item.id === budgetId ? nextBudget : item))
            : [nextBudget, ...patient.budgets]
        )
      }),
      budgetId ? "Presupuesto actualizado." : "Presupuesto guardado."
    );

    setSelectedPatientId(targetPatientId);
    setActiveView("patients");

    if (intent === "print") {
      setModalState({ type: "budget-preview", patientId: targetPatientId, budgetId: nextBudget.id });
      return;
    }

    closeModals();
  };

  const submitRecordForm = (
    kind: RecordKind,
    values: Record<string, string>,
    modalPatientId?: string,
    itemId?: string
  ) => {
    const targetPatientId = modalPatientId ?? values.patientTarget;
    if (!targetPatientId) return;

    const currentPatient = clinicPatients.find((patient) => patient.id === targetPatientId) ?? null;

    if (kind === "treatment") {
      const existingTreatment = itemId ? currentPatient?.treatments.find((item) => item.id === itemId) ?? null : null;
      const existingFinance =
        currentPatient?.finances.find(
          (entry) =>
            entry.id === existingTreatment?.linkedFinanceId ||
            (itemId ? entry.linkedTreatmentId === itemId : false)
        ) ?? null;
      const treatmentId = itemId ?? createId("treatment");
      const totalAmount = toAmount(values.totalAmount);
      const practitioner = normalizePractitionerName(values.practitioner);
      const linkedFinance = buildTreatmentFinanceEntry(treatmentId, values, existingFinance ?? undefined);

      const nextItem: Treatment = {
        id: treatmentId,
        date: values.date || todayKey(),
        category: values.category.trim() || "Consulta",
        detail: values.detail.trim(),
        practitioner,
        status: (values.status || "Realizado") as Treatment["status"],
        totalAmount,
        paidAmount: linkedFinance.paidAmount,
        pendingAmount: linkedFinance.pendingAmount,
        note: values.note.trim(),
        linkedFinanceId: linkedFinance?.id
      };

      applyPatientMutation(
        targetPatientId,
        (patient) => {
          const nextTreatments = sortByDateDesc(
            itemId
              ? patient.treatments.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.treatments]
          );

          const financeWithoutLinked = patient.finances.filter(
            (entry) =>
              entry.id !== existingFinance?.id &&
              entry.linkedTreatmentId !== treatmentId
          );

          const nextFinances = linkedFinance
            ? sortFinancesByActivity([linkedFinance, ...financeWithoutLinked])
            : sortFinancesByActivity(financeWithoutLinked);

          const syncedTreatments = syncTreatmentsFromFinances(nextTreatments, nextFinances);

          return {
            ...patient,
            treatments: syncedTreatments,
            finances: nextFinances
          };
        },
        itemId ? "Atencion y cobro actualizados." : "Atencion y cobro guardados."
      );
    }

    if (kind === "evolution") {
      const nextItem: EvolutionEntry = {
        id: itemId ?? createId("evolution"),
        date: values.date || todayKey(),
        reason: values.reason.trim(),
        findings: values.findings.trim(),
        diagnosis: values.diagnosis.trim(),
        procedure: values.procedure.trim(),
        indications: values.indications.trim(),
        nextStep: values.nextStep.trim()
      };

      applyPatientMutation(
        targetPatientId,
        (patient) => ({
          ...patient,
          evolutions: sortByDateDesc(
            itemId
              ? patient.evolutions.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.evolutions]
          )
        }),
        itemId ? "Evolucion actualizada." : "Evolucion guardada."
      );
    }

    if (kind === "followup") {
      const nextItem: FollowUp = {
        id: itemId ?? createId("followup"),
        eventDate: values.eventDate || todayKey(),
        dueDate: values.dueDate || todayKey(),
        type: values.type.trim(),
        source: values.source.trim(),
        status: (values.status || "Pendiente") as FollowUp["status"],
        notes: values.notes.trim()
      };

      applyPatientMutation(
        targetPatientId,
        (patient) => ({
          ...patient,
          followUps: sortFollowUps(
            itemId
              ? patient.followUps.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.followUps]
          )
        }),
        itemId ? "Seguimiento actualizado." : "Seguimiento guardado."
      );
    }

    if (kind === "finance") {
      const existingFinance = itemId ? currentPatient?.finances.find((entry) => entry.id === itemId) ?? null : null;
      const totalAmount = toAmount(values.totalAmount);
      const practitioner = normalizePractitionerName(values.practitioner);
      const initialPaymentAmount = itemId ? 0 : Math.min(toAmount(values.initialPaymentAmount), totalAmount);
      const nextItem = syncFinanceEntry({
        id: itemId ?? createId("finance"),
        date: values.date || todayKey(),
        concept: values.concept.trim(),
        practitioner,
        status: describeFinanceStatus(totalAmount, existingFinance?.paidAmount ?? initialPaymentAmount),
        totalAmount,
        paidAmount: existingFinance?.paidAmount ?? initialPaymentAmount,
        pendingAmount: Math.max(totalAmount - (existingFinance?.paidAmount ?? initialPaymentAmount), 0),
        description: values.description.trim(),
        linkedTreatmentId: existingFinance?.linkedTreatmentId,
        payments:
          itemId && existingFinance
            ? existingFinance.payments
            : initialPaymentAmount > 0
              ? [
                createPaymentEntry({
                  id: createId("payment"),
                  date: values.date || todayKey(),
                  amount: initialPaymentAmount,
                  method: "Efectivo",
                  note: "Pago inicial registrado junto con el cargo.",
                  fromMarketing: values.initialPaymentFromMarketing === "true"
                })
              ]
              : []
      });

      applyPatientMutation(
        targetPatientId,
        (patient) => {
          const nextFinances = sortFinancesByActivity(
            itemId
              ? patient.finances.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.finances]
          );

          return {
            ...patient,
            finances: nextFinances,
            treatments: syncTreatmentsFromFinances(patient.treatments, nextFinances)
          };
        },
        itemId ? "Deuda actualizada." : "Cargo guardado."
      );
    }

    if (kind === "payment") {
      const financeTargetId = values.financeTarget;
      const amount = toAmount(values.amount);
      const method = values.method.trim() || "Efectivo";
      const note = values.note.trim();
      const financeTarget = currentPatient?.finances.find((entry) => entry.id === financeTargetId) ?? null;

      if (!financeTarget) {
        window.alert("Debes elegir una deuda valida para registrar el pago.");
        return;
      }

      if (amount <= 0) {
        window.alert("Ingresa un monto valido para el pago.");
        return;
      }

      if (amount > financeTarget.pendingAmount) {
        window.alert("El pago no puede ser mayor al saldo pendiente.");
        return;
      }

      const paymentEntry: PaymentEntry = createPaymentEntry({
        id: createId("payment"),
        date: values.date || todayKey(),
        amount,
        method,
        note,
        fromMarketing: values.fromMarketing === "true"
      });

      applyPatientMutation(
        targetPatientId,
        (patient) => {
          const nextFinances = sortFinancesByActivity(
            patient.finances.map((entry) =>
              entry.id === financeTargetId ? appendPaymentToFinance(entry, paymentEntry) : entry
            )
          );

          return {
            ...patient,
            finances: nextFinances,
            treatments: syncTreatmentsFromFinances(patient.treatments, nextFinances)
          };
        },
        "Pago registrado."
      );
    }

    if (kind === "expense") {
      const amount = toAmount(values.amount);

      const nextItem: Expense = {
        id: itemId ?? createId("patient-expense"),
        date: values.date || todayKey(),
        concept: values.concept.trim(),
        category: values.category.trim() || "Laboratorio",
        amount,
        description: values.description.trim(),
        scope: "patient"
      };

      applyPatientMutation(
        targetPatientId,
        (patient) => ({
          ...patient,
          patientExpenses: sortByDateDesc(
            itemId
              ? patient.patientExpenses.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.patientExpenses]
          )
        }),
        itemId ? "Costo del paciente actualizado." : "Costo del paciente guardado."
      );
    }

    if (kind === "note") {
      const nextItem: NoteEntry = {
        id: itemId ?? createId("note"),
        date: values.date || todayKey(),
        text: values.text.trim()
      };

      applyPatientMutation(
        targetPatientId,
        (patient) => ({
          ...patient,
          notes: sortByDateDesc(
            itemId
              ? patient.notes.map((item) => (item.id === itemId ? nextItem : item))
              : [nextItem, ...patient.notes]
          )
        }),
        itemId ? "Nota actualizada." : "Nota guardada."
      );
    }

    setSelectedPatientId(targetPatientId);
    setActiveView("patients");
    closeModals();
  };

  const handleDeleteConfirmed = () => {
    if (!deleteIntent) return;

    if (deleteIntent.target === "patient") {
      const previousPatients = clinicPatients;
      const previousSelectedPatientId = selectedPatientId;
      const nextPatients = clinicPatients.filter((patient) => patient.id !== deleteIntent.patientId);

      setClinicPatients(nextPatients);
      if (selectedPatientId === deleteIntent.patientId) {
        setSelectedPatientId(nextPatients[0]?.id ?? null);
      }
      closeModals();

      void persistFirebaseChange(
        () => deletePatientRecord(deleteIntent.patientId),
        "Ficha eliminada.",
        () => {
          setClinicPatients(previousPatients);
          setSelectedPatientId(previousSelectedPatientId);
        }
      );
      return;
    }

    if (deleteIntent.target === "marketing-expense") {
      const previousExpenses = clinicExpenses;
      const nextExpenses = clinicExpenses.filter((expense) => expense.id !== deleteIntent.expenseId);

      setClinicExpenses(nextExpenses);
      closeModals();

      void persistFirebaseChange(
        () => deleteExpenseRecord(deleteIntent.expenseId),
        "Gasto de marketing eliminado.",
        () => setClinicExpenses(previousExpenses)
      );
      return;
    }

    const { target, patientId, itemId } = deleteIntent;

    if (target === "treatment") {
      applyPatientMutation(
        patientId,
        (patient) => {
          const linkedTreatment = patient.treatments.find((item) => item.id === itemId) ?? null;
          return {
            ...patient,
            treatments: patient.treatments.filter((item) => item.id !== itemId),
            finances: patient.finances.filter(
              (entry) =>
                entry.id !== linkedTreatment?.linkedFinanceId &&
                entry.linkedTreatmentId !== itemId
            ),
            patientExpenses: patient.patientExpenses.filter((entry) => entry.linkedTreatmentId !== itemId)
          };
        },
        "Atencion eliminada."
      );
    }

    if (target === "evolution") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          evolutions: patient.evolutions.filter((item) => item.id !== itemId)
        }),
        "Evolucion eliminada."
      );
    }

    if (target === "followup") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          followUps: patient.followUps.filter((item) => item.id !== itemId)
        }),
        "Seguimiento eliminado."
      );
    }

    if (target === "budget") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          budgets: patient.budgets.filter((item) => item.id !== itemId)
        }),
        "Presupuesto eliminado."
      );
    }

    if (target === "finance") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          finances: patient.finances.filter((item) => item.id !== itemId)
        }),
        "Movimiento eliminado."
      );
    }

    if (target === "expense") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          patientExpenses: patient.patientExpenses.filter((item) => item.id !== itemId)
        }),
        "Costo del paciente eliminado."
      );
    }

    if (target === "note") {
      applyPatientMutation(
        patientId,
        (patient) => ({
          ...patient,
          notes: patient.notes.filter((item) => item.id !== itemId)
        }),
        "Nota eliminada."
      );
    }

    closeModals();
  };

  const getRecordFields = (kind: RecordKind, patientId?: string, itemId?: string): ModalField[] => {
    const patient = patientId ? clinicPatients.find((entry) => entry.id === patientId) ?? null : null;
    const needsPatientField = (kind === "treatment" || kind === "expense") && !patientId;
    const patientField: ModalField[] = needsPatientField
      ? [
          {
            name: "patientTarget",
            label: "Paciente",
            type: "search-select",
            required: true,
            placeholder: "Buscar por nombre o telefono",
            options: patientOptions
          }
        ]
      : [];

    if (kind === "treatment") {
      return [
        ...patientField,
        { name: "date", label: "Fecha", type: "date", required: true },
        {
          name: "category",
          label: "Categoria",
          type: "select",
          options: ["Consulta", "Periodoncia", "Operatoria", "Endodoncia", "Cirugia", "Implantes", "Control", "Otro"]
        },
        { name: "detail", label: "Tratamiento realizado", type: "text", required: true },
        {
          name: "practitioner",
          label: "Doctor tratante",
          type: "text",
          required: true,
          placeholder: "Elige uno ya cargado o escribe uno nuevo",
          suggestions: availableDoctors
        },
        { name: "totalAmount", label: "Monto del tratamiento", type: "number", min: 0, step: "1", required: true },
        ...(itemId
          ? []
          : [
              { name: "paidAmount", label: "Cuanto pago hoy", type: "number", min: 0, step: "1" } as ModalField,
              { name: "paidFromMarketing", label: "Este cobro vino de marketing", type: "checkbox" } as ModalField
            ]),
        {
          name: "status",
          label: "Estado clinico",
          type: "select",
          options: ["Realizado", "Planificado", "Control pendiente", "Cancelado"]
        },
        { name: "note", label: "Observacion", type: "textarea", rows: 4 }
      ];
    }

    if (kind === "evolution") {
      return [
        { name: "date", label: "Fecha", type: "date", required: true },
        { name: "reason", label: "Motivo de consulta", type: "text" },
        { name: "findings", label: "Hallazgos", type: "textarea", rows: 4 },
        { name: "diagnosis", label: "Diagnostico", type: "text" },
        { name: "procedure", label: "Procedimiento realizado", type: "text" },
        { name: "indications", label: "Indicaciones", type: "textarea", rows: 3 },
        { name: "nextStep", label: "Proxima conducta", type: "text" }
      ];
    }

    if (kind === "followup") {
      return [
        { name: "eventDate", label: "Fecha del evento", type: "date", required: true },
        { name: "dueDate", label: "Fecha objetivo", type: "date", required: true },
        {
          name: "type",
          label: "Tipo de seguimiento",
          type: "select",
          options: [
            "Control general",
            "Control postquirurgico",
            "Retiro de puntos",
            "Reevaluacion periodontal",
            "Mantenimiento 6 meses",
            "Otro"
          ]
        },
        { name: "source", label: "Origen o procedimiento", type: "text" },
        {
          name: "status",
          label: "Estado",
          type: "select",
          options: ["Pendiente", "Realizado", "Reprogramado", "Cancelado"]
        },
        { name: "notes", label: "Observacion", type: "textarea", rows: 3 }
      ];
    }

    if (kind === "finance") {
      return [
        { name: "date", label: "Fecha", type: "date", required: true },
        { name: "concept", label: "Concepto", type: "text", required: true },
        {
          name: "practitioner",
          label: "Doctor tratante",
          type: "text",
          placeholder: "Elige uno ya cargado o escribe uno nuevo",
          suggestions: availableDoctors
        },
        { name: "totalAmount", label: "Monto total", type: "number", min: 0, step: "1", required: true },
        ...(itemId
          ? []
          : [
              { name: "initialPaymentAmount", label: "Pago en esta carga", type: "number", min: 0, step: "1" } as ModalField,
              { name: "initialPaymentFromMarketing", label: "Este pago vino de marketing", type: "checkbox" } as ModalField
            ]),
        { name: "description", label: "Detalle", type: "textarea", rows: 4 }
      ];
    }

    if (kind === "payment") {
      const pendingFinanceOptions =
        patient?.finances
          .filter((entry) => entry.pendingAmount > 0)
          .map((entry) => ({
            value: entry.id,
            label: `${entry.concept} · pendiente ${formatGs(entry.pendingAmount)}`
          })) ?? [];

      return [
        { name: "date", label: "Fecha del pago", type: "date", required: true },
        {
          name: "financeTarget",
          label: "Deuda o tratamiento",
          type: "search-select",
          placeholder: "Buscar saldo pendiente",
          required: true,
          options: pendingFinanceOptions
        },
        { name: "amount", label: "Monto abonado", type: "number", min: 0, step: "1", required: true },
        {
          name: "method",
          label: "Forma de pago",
          type: "select",
          options: ["Efectivo", "Transferencia", "Tarjeta", "QR", "Otro"]
        },
        { name: "fromMarketing", label: "Este pago vino de marketing", type: "checkbox" },
        { name: "note", label: "Observacion", type: "textarea", rows: 4 }
      ];
    }

    if (kind === "expense") {
      return [
        ...patientField,
        { name: "date", label: "Fecha", type: "date", required: true },
        { name: "concept", label: "Concepto del costo", type: "text", required: true },
        {
          name: "category",
          label: "Categoria",
          type: "select",
          options: ["Laboratorio", "Placa o protesis", "Material descartable", "Insumo clinico", "Honorario derivado", "Otro"]
        },
        { name: "amount", label: "Monto del costo", type: "number", min: 0, step: "1", required: true },
        { name: "description", label: "Detalle", type: "textarea", rows: 4 }
      ];
    }

    return [
      { name: "date", label: "Fecha", type: "date", required: true },
      { name: "text", label: "Nota", type: "textarea", rows: 5, required: true }
    ];
  };

  const getRecordInitialValues = (kind: RecordKind, patientId?: string, itemId?: string): Record<string, string> => {
    const patient = patientId ? clinicPatients.find((entry) => entry.id === patientId) ?? null : null;
    const defaultPatientTarget = patientId && patient ? patient.id : "";

    if (kind === "treatment") {
      const item = itemId ? patient?.treatments.find((entry) => entry.id === itemId) ?? null : null;
      return {
        patientTarget: defaultPatientTarget,
        date: item?.date ?? todayKey(),
        category: item?.category ?? "Consulta",
        detail: item?.detail ?? "",
        practitioner: item?.practitioner ?? "",
        totalAmount: item ? String(item.totalAmount) : "",
        paidAmount: "",
        paidFromMarketing: "false",
        status: item?.status ?? "Realizado",
        note: item?.note ?? ""
      };
    }

    if (kind === "evolution") {
      const item = itemId ? patient?.evolutions.find((entry) => entry.id === itemId) ?? null : null;
      return {
        date: item?.date ?? todayKey(),
        reason: item?.reason ?? "",
        findings: item?.findings ?? "",
        diagnosis: item?.diagnosis ?? "",
        procedure: item?.procedure ?? "",
        indications: item?.indications ?? "",
        nextStep: item?.nextStep ?? ""
      };
    }

    if (kind === "followup") {
      const item = itemId ? patient?.followUps.find((entry) => entry.id === itemId) ?? null : null;
      if (!item) {
        const latestTreatment = patient ? sortByDateDesc(patient.treatments)[0] ?? null : null;
        const eventDate = latestTreatment?.date ?? todayKey();
        const suggested =
          latestTreatment
            ? getSuggestedFollowUpFromAttention(
                [{ category: latestTreatment.category, detail: latestTreatment.detail }],
                eventDate
              )
            : null;

        return {
          eventDate,
          dueDate: suggested?.dueDate ?? getAutoFollowUpDateForType("Control general", eventDate) ?? eventDate,
          type: suggested?.type ?? "Control general",
          source: latestTreatment?.detail ?? "",
          status: "Pendiente",
          notes: suggested?.note ?? ""
        };
      }

      return {
        eventDate: item?.eventDate ?? todayKey(),
        dueDate: item?.dueDate ?? todayKey(),
        type: item?.type ?? "Control general",
        source: item?.source ?? "",
        status: item?.status ?? "Pendiente",
        notes: item?.notes ?? ""
      };
    }

    if (kind === "finance") {
      const item = itemId ? patient?.finances.find((entry) => entry.id === itemId) ?? null : null;
      return {
        date: item?.date ?? todayKey(),
        concept: item?.concept ?? "",
        practitioner: item?.practitioner ?? "",
        totalAmount: item ? String(item.totalAmount) : "",
        initialPaymentAmount: "",
        initialPaymentFromMarketing: "false",
        description: item?.description ?? ""
      };
    }

    if (kind === "payment") {
      const pendingFinance = patient?.finances.find((entry) => entry.pendingAmount > 0) ?? null;
      return {
        date: todayKey(),
        financeTarget: pendingFinance?.id ?? "",
        amount: "",
        method: "Efectivo",
        fromMarketing: "false",
        note: ""
      };
    }

    if (kind === "expense") {
      const item = itemId ? patient?.patientExpenses.find((entry) => entry.id === itemId) ?? null : null;
      return {
        patientTarget: defaultPatientTarget,
        date: item?.date ?? todayKey(),
        concept: item?.concept ?? "",
        category: item?.category ?? "Laboratorio",
        amount: item ? String(item.amount) : "",
        description: item?.description ?? ""
      };
    }

    const item = itemId ? patient?.notes.find((entry) => entry.id === itemId) ?? null : null;
    return {
      date: item?.date ?? todayKey(),
      text: item?.text ?? ""
    };
  };

  const getBudgetInitialValues = (patientId?: string, budgetId?: string, duplicateBudgetId?: string): BudgetFormValues => {
    const patient = patientId ? clinicPatients.find((entry) => entry.id === patientId) ?? null : null;
    const budget = budgetId ? patient?.budgets.find((entry) => entry.id === budgetId) ?? null : null;
    const duplicateSource =
      !budget && duplicateBudgetId ? patient?.budgets.find((entry) => entry.id === duplicateBudgetId) ?? null : null;

    if (budget) {
      return {
        patientTarget: patientId ?? "",
        status: budget.status,
        createdAt: budget.createdAt,
        validityDays: budget.validityDays === 30 ? "30" : "15",
        validUntil: budget.validUntil,
        note: budget.note,
        items:
          budget.items.length > 0
            ? budget.items.map((item) => ({
                id: item.id,
                quantity: String(item.quantity),
                detail: item.detail,
                unitPrice: String(item.unitPrice)
              }))
            : [createBudgetLineFormItem()]
      };
    }

    if (duplicateSource) {
      return {
        patientTarget: patientId ?? "",
        status: "Pendiente",
        createdAt: todayKey(),
        validityDays: duplicateSource.validityDays === 30 ? "30" : "15",
        validUntil: "",
        note: duplicateSource.note,
        items:
          duplicateSource.items.length > 0
            ? duplicateSource.items.map((item) => ({
                id: createId("budget-item"),
                quantity: String(item.quantity),
                detail: item.detail,
                unitPrice: String(item.unitPrice)
              }))
            : [createBudgetLineFormItem()]
      };
    }

    return {
      patientTarget: patientId ?? "",
      status: "Pendiente",
      createdAt: todayKey(),
      validityDays: "15",
      validUntil: "",
      note: "",
      items: [createBudgetLineFormItem()]
    };
  };

  const transformFollowUpValues = (
    nextValues: Record<string, string>,
    changedField: string
  ): Record<string, string> => {
    if (changedField !== "type" && changedField !== "eventDate") {
      return nextValues;
    }

    const autoDueDate = getAutoFollowUpDateForType(nextValues.type, nextValues.eventDate);
    if (!autoDueDate) return nextValues;

    return {
      ...nextValues,
      dueDate: autoDueDate
    };
  };

  const modalConfig = useMemo(() => {
    if (!modalState) return null;

    if (modalState.type === "budget-preview") {
      const patient = clinicPatients.find((entry) => entry.id === modalState.patientId) ?? null;
      const budget = patient?.budgets.find((entry) => entry.id === modalState.budgetId) ?? null;

      if (!patient || !budget) return null;

      return (
        <BudgetPrintPreview
          patient={patient}
          budget={budget}
          onClose={closeModals}
          onDuplicate={() => openBudgetDuplicate(patient.id, budget.id)}
          onEdit={() =>
            setModalState({
              type: "record-edit",
              kind: "budget",
              patientId: patient.id,
              itemId: budget.id
            })
          }
        />
      );
    }

    if (modalState.type === "patient-create") {
      return (
        <EntityModal
          title="Nuevo paciente"
          subtitle="Crea una nueva ficha clinica para el consultorio."
          submitLabel="Guardar paciente"
          fields={patientFields()}
          initialValues={defaultPatientValues()}
          onClose={closeModals}
          onSubmit={(values) => submitPatientForm(values)}
        />
      );
    }

    if (modalState.type === "marketing-expense-create") {
      return (
        <EntityModal
          title="Nuevo gasto de marketing"
          subtitle="Carga un gasto independiente de agencia, anuncios, contenido o diseno."
          submitLabel="Guardar gasto"
          fields={marketingExpenseFields()}
          initialValues={defaultMarketingExpenseValues()}
          onClose={closeModals}
          onSubmit={(values) => submitMarketingExpenseForm(values)}
        />
      );
    }

    if (modalState.type === "marketing-expense-edit") {
      const expense = clinicExpenses.find((entry) => entry.id === modalState.expenseId) ?? null;
      if (!expense) return null;

      return (
        <EntityModal
          title="Editar gasto de marketing"
          subtitle="Ajusta el gasto sin tocar la ficha de ningun paciente."
          submitLabel="Guardar cambios"
          fields={marketingExpenseFields()}
          initialValues={defaultMarketingExpenseValues(expense)}
          onClose={closeModals}
          onSubmit={(values) => submitMarketingExpenseForm(values, expense.id)}
        />
      );
    }

    if (modalState.type === "patient-edit") {
      const patient = clinicPatients.find((entry) => entry.id === modalState.patientId);
      if (!patient) return null;

      return (
        <EntityModal
          title="Editar ficha"
          subtitle="Actualiza los datos generales del paciente."
          submitLabel="Guardar cambios"
          fields={patientFields()}
          initialValues={defaultPatientValues(patient)}
          onClose={closeModals}
          onSubmit={(values) => submitPatientForm(values, patient.id)}
        />
      );
    }

    const patient = modalState.patientId ? clinicPatients.find((entry) => entry.id === modalState.patientId) : null;
    const patientLabel = patient ? patient.fullName : "Selecciona un paciente";
    const createKindTitles: Record<RecordKind, string> = {
      treatment: "Atencion rapida",
      evolution: "Nueva evolucion",
      followup: "Nuevo seguimiento",
      budget: "Nuevo presupuesto",
      finance: "Nueva deuda o cargo",
      payment: "Registrar pago",
      expense: "Nuevo costo del paciente",
      note: "Nueva nota"
    };
    const editKindTitles: Record<RecordKind, string> = {
      treatment: "Editar atencion completa",
      evolution: "Editar evolucion",
      followup: "Editar seguimiento",
      budget: "Editar presupuesto",
      finance: "Editar deuda o cargo",
      payment: "Editar pago",
      expense: "Editar costo del paciente",
      note: "Editar nota"
    };

    if (modalState.kind === "treatment" && modalState.type === "record-create") {
      return (
        <AttentionModal
          title="Atencion rapida"
          subtitle={
            modalState.patientId
              ? `Paciente: ${patientLabel}`
              : "Resuelve la visita completa aqui: paciente, tratamientos, cobro y proximo control."
          }
          submitLabel="Guardar visita"
          patientOptions={patientOptions}
          practitionerSuggestions={availableDoctors}
          initialValues={{
            patientTarget: modalState.patientId ?? "",
            date: todayKey(),
            practitioner: "",
            note: "",
            createPatientInline: false,
            quickPatientName: "",
            quickPatientPhone: "",
            scheduleFollowUp: false,
            followUpDueDate: "",
            followUpType: "Control general",
            followUpNotes: "",
            items: [
              {
                id: createId("item"),
                category: "Consulta",
                detail: "",
                status: "Realizado",
                totalAmount: "",
                paidAmount: "",
                paidFromMarketing: false,
                costAmount: "",
                costCategory: "Laboratorio"
              }
            ]
          }}
          lockPatient={Boolean(modalState.patientId)}
          onClose={closeModals}
          onSubmit={(values) => submitAttentionForm(values, modalState.patientId)}
        />
      );
    }

    if (modalState.kind === "budget") {
      const duplicateBudgetId = modalState.type === "record-create" ? modalState.prefillFromId : undefined;
      const budgetTitle =
        modalState.type === "record-create"
          ? duplicateBudgetId
            ? "Duplicar presupuesto"
            : "Nuevo presupuesto"
          : "Editar presupuesto";
      const budgetSubtitle = modalState.patientId
        ? duplicateBudgetId
          ? `Paciente: ${patientLabel}. Tomamos el presupuesto anterior como base para que solo ajustes lo necesario.`
          : `Paciente: ${patientLabel}`
        : "Elige paciente, carga filas y deja el documento listo para imprimir.";

      return (
        <BudgetModal
          title={budgetTitle}
          subtitle={budgetSubtitle}
          submitLabel="Guardar presupuesto"
          patientOptions={patientOptions}
          initialValues={getBudgetInitialValues(
            modalState.patientId,
            modalState.type === "record-edit" ? modalState.itemId : undefined,
            duplicateBudgetId
          )}
          lockPatient={Boolean(modalState.patientId)}
          lockedPatientLabel={patientLabel}
          onClose={closeModals}
          onSubmit={(values, intent) =>
            submitBudgetForm(
              values,
              intent,
              modalState.type === "record-edit" ? modalState.itemId : undefined
            )
          }
        />
      );
    }

    return (
      <EntityModal
        title={modalState.type === "record-create" ? createKindTitles[modalState.kind] : editKindTitles[modalState.kind]}
        subtitle={
          modalState.patientId
            ? `Paciente: ${patientLabel}`
            : modalState.kind === "treatment"
              ? "Elige paciente, doctor y cobro en una sola carga."
              : modalState.kind === "payment"
                ? "Registra un abono nuevo sin tocar el historial anterior."
              : modalState.kind === "expense"
                ? "Elige paciente y carga el costo real del caso."
              : "Elige paciente y completa los datos."
        }
        submitLabel={
          modalState.kind === "payment"
            ? "Guardar pago"
            : modalState.type === "record-create"
              ? "Guardar registro"
              : "Guardar cambios"
        }
        fields={getRecordFields(
          modalState.kind,
          modalState.patientId,
          modalState.type === "record-edit" ? modalState.itemId : undefined
        )}
        initialValues={getRecordInitialValues(
          modalState.kind,
          modalState.patientId,
          modalState.type === "record-edit" ? modalState.itemId : undefined
        )}
        transformValues={modalState.kind === "followup" ? transformFollowUpValues : undefined}
        onClose={closeModals}
        onSubmit={(values) =>
          submitRecordForm(
            modalState.kind,
            values,
            modalState.patientId,
            modalState.type === "record-edit" ? modalState.itemId : undefined
          )
        }
      />
    );
  }, [availableDoctors, clinicExpenses, clinicPatients, modalState, patientOptions]);

  const deleteConfig = useMemo(() => {
    if (!deleteIntent) return null;

    if (deleteIntent.target === "patient") {
      const patient = clinicPatients.find((entry) => entry.id === deleteIntent.patientId);
      return {
        title: "Eliminar ficha del paciente",
        message: `Esta accion quitara la ficha de ${patient?.fullName ?? "este paciente"} de la base actual.`,
        confirmLabel: "Eliminar ficha"
      };
    }

    if (deleteIntent.target === "marketing-expense") {
      const expense = clinicExpenses.find((entry) => entry.id === deleteIntent.expenseId) ?? null;
      return {
        title: "Eliminar gasto de marketing",
        message: `Esta accion eliminara ${expense?.concept ?? "este gasto"} del panel de marketing.`,
        confirmLabel: "Eliminar gasto"
      };
    }

    const labels: Record<RecordKind, string> = {
      treatment: "esta atencion completa",
      evolution: "esta evolucion",
      followup: "este seguimiento",
      budget: "este presupuesto",
      finance: "esta deuda o cargo",
      payment: "este pago",
      expense: "este costo del paciente",
      note: "esta nota"
    };

    return {
      title: "Eliminar registro",
      message: `Esta accion eliminara ${labels[deleteIntent.target]}.`,
      confirmLabel: "Eliminar registro"
    };
  }, [clinicExpenses, clinicPatients, deleteIntent]);

  const authScreenError = manualAuthError ?? authError;

  if (sessionState !== "authenticated") {
    return (
      <AuthScreen
        email={loginEmail}
        password={loginPassword}
        sessionState={sessionState}
        authError={authScreenError}
        isSubmitting={isSubmitting}
        onEmailChange={setLoginEmail}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLoginSubmit}
      />
    );
  }

  const syncPillClass =
    syncState === "saved"
      ? "status-pill status-pill--success"
      : syncState === "error"
        ? "status-pill status-pill--critical"
        : syncState === "saving"
          ? "status-pill status-pill--soon"
          : "status-pill status-pill--neutral";

  const handlePeriodStartChange = (nextMonth: string) => {
    setIsPeriodAuto(false);
    setPeriodStartMonth(nextMonth);
    setPeriodEndMonth((currentEndMonth) => (nextMonth > currentEndMonth ? nextMonth : currentEndMonth));
  };

  const handlePeriodEndChange = (nextMonth: string) => {
    setIsPeriodAuto(false);
    setPeriodEndMonth(nextMonth);
    setPeriodStartMonth((currentStartMonth) => (nextMonth < currentStartMonth ? nextMonth : currentStartMonth));
  };

  const renderMainView = () => {
    if (activeView === "patients") {
      return (
        <section className="patients-view">
          <PatientRoster
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            activeLetter={activePatientLetter}
            onActiveLetterChange={setActivePatientLetter}
            activeDoctor={activeDoctorFilter}
            onActiveDoctorChange={setActiveDoctorFilter}
            availableLetters={availablePatientLetters}
            availableDoctors={availableDoctors}
            totalPatients={clinicPatients.length}
            patients={filteredPatients}
            selectedPatientId={selectedPatientId}
            onSelectPatient={handleOpenPatient}
            onDeletePatient={askDeletePatient}
          />

          {selectedPatient ? (
            <div className="patient-sheet-layer">
              <button
                type="button"
                className="patient-sheet-backdrop"
                aria-label="Cerrar ficha del paciente"
                onClick={closePatientSheet}
              />

              <aside className="patient-sheet">
                <div className="patient-sheet__toolbar">
                  <div>
                    <p className="eyebrow">Ficha abierta</p>
                    <h3>{selectedPatient.fullName}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={closePatientSheet}>
                    Cerrar
                  </button>
                </div>

                <PatientWorkspace
                  patient={selectedPatient}
                  onEditPatient={(patientId) => setModalState({ type: "patient-edit", patientId })}
                  onDeletePatient={askDeletePatient}
                  onCreateRecord={openCreateRecord}
                  onEditRecord={openEditRecord}
                  onDeleteRecord={askDeleteRecord}
                  onPreviewBudget={openBudgetPreview}
                  onDuplicateBudget={openBudgetDuplicate}
                />
              </aside>
            </div>
          ) : null}
        </section>
      );
    }

    if (activeView === "alerts") {
      return (
        <section className="single-column">
          <AlertBoard
            alerts={alerts}
            activeFilter={activeAlertFilter}
            onChangeFilter={setActiveAlertFilter}
            onOpenPatient={handleOpenPatient}
          />
        </section>
      );
    }

    if (activeView === "finance") {
      return (
        <section className="single-column">
          <PeriodFinancials
            incomeAmount={metrics.incomeAmount}
            pendingAmount={metrics.pendingAmount}
            expensesAmount={metrics.expensesAmount}
            netAmount={metrics.netAmount}
            pendingCollections={pendingCollections}
            collectedEntries={collectedEntries}
            expenses={periodExpenses}
            onOpenPatient={handleOpenPatient}
          />
        </section>
      );
    }

    if (activeView === "marketing") {
      return (
        <section className="single-column">
          <MarketingDashboard
            spendAmount={marketingData.spendAmount}
            agencyAmount={marketingData.agencyAmount}
            cardAmount={marketingData.cardAmount}
            incomeAmount={marketingData.incomeAmount}
            netAmount={marketingData.netAmount}
            roas={marketingData.roas}
            marketingPatientsCount={marketingData.marketingPatientsCount}
            expenses={marketingData.expenses}
            incomeEntries={marketingData.incomeEntries}
            onOpenPatient={handleOpenPatient}
            onCreateExpense={openMarketingExpenseCreate}
            onEditExpense={openMarketingExpenseEdit}
            onDeleteExpense={askDeleteMarketingExpense}
          />
        </section>
      );
    }

    return (
      <section className="home-layout">
        <section className="home-banner">
          <div className="home-banner__copy">
            <p className="eyebrow">Inicio</p>
            <h2>{periodLabel}</h2>
            <p>Un panel mas limpio para ver lo importante primero y entrar a cada area solo cuando la necesites.</p>
          </div>

          <div className="status-pill status-pill--neutral">{activeAlertsCount} alertas activas</div>
        </section>

        <section className="metrics-grid">
          <MetricCard label="Pacientes cargados" value={String(metrics.patientsCount)} detail="Base activa del consultorio" tone="obsidian" />
          <MetricCard label="Tratamientos del periodo" value={String(metrics.treatmentsCount)} detail="Atenciones registradas en el periodo" tone="gold" />
          <MetricCard label="Cobrado del periodo" value={formatGs(metrics.incomeAmount)} detail="Ingresos ya percibidos" tone="emerald" />
          <MetricCard
            label="Pendiente del periodo"
            value={formatGs(metrics.pendingAmount)}
            detail={`${metrics.pendingCases} caso(s) con saldo abierto`}
            tone="ruby"
          />
        </section>

        <section className="shortcut-grid">
          <button type="button" className="action-tile action-tile--patients" onClick={() => setActiveView("patients")}>
            <div className="action-tile__header">
              <div>
                <p className="eyebrow">Pacientes</p>
                <h3>Fichas y busqueda</h3>
              </div>
              <span className="action-tile__count">{metrics.patientsCount}</span>
            </div>
            <p className="action-tile__meta">Abrir listado, filtrar por doctor y entrar a cada ficha clinica.</p>
          </button>

          <button type="button" className="action-tile action-tile--alerts" onClick={() => setActiveView("alerts")}>
            <div className="action-tile__header">
              <div>
                <p className="eyebrow">Alertas</p>
                <h3>Controles y vencimientos</h3>
              </div>
              <span className="action-tile__count">{activeAlertsCount}</span>
            </div>
            <p className="action-tile__meta">
              {urgentAlertsCount > 0
                ? `${urgentAlertsCount} urgente(s), mas controles proximos y futuros.`
                : "Ver vencidos, hoy, proximos y futuros controles sin saturar el inicio."}
            </p>
          </button>

          <button type="button" className="action-tile action-tile--finance" onClick={() => setActiveView("finance")}>
            <div className="action-tile__header">
              <div>
                <p className="eyebrow">Finanzas</p>
                <h3>Cobros y resumen</h3>
              </div>
              <span className="action-tile__count">{metrics.pendingCases}</span>
            </div>
            <p className="action-tile__meta">Entrar al resumen financiero solo cuando quieras revisar cobros.</p>
          </button>

          <button type="button" className="action-tile action-tile--marketing" onClick={() => setActiveView("marketing")}>
            <div className="action-tile__header">
              <div>
                <p className="eyebrow">Marketing</p>
                <h3>Gastos e ingresos</h3>
              </div>
              <span className="action-tile__count">{marketingData.marketingPatientsCount}</span>
            </div>
            <p className="action-tile__meta">Ver agencia, tarjeta e ingresos marcados como provenientes de marketing.</p>
          </button>
        </section>
      </section>
    );
  };

  return (
    <div className="page-shell">
      <div className="page-backdrop" />

      <header className="topbar">
        <div className="topbar__brand topbar__brand--logo">
          <img className="brand-logo" src={logoWhite} alt={clinicProfile.appName} />

          <div className="topbar__brand-copy">
            <p className="eyebrow">{clinicProfile.specialty}</p>
          </div>
        </div>

        <div className="topbar__actions">
          {syncMessage ? <span className={syncPillClass}>{syncMessage}</span> : null}
          {userEmail ? <span className="status-pill status-pill--neutral">{userEmail}</span> : null}
          <button type="button" className="outline-button" onClick={handleLogout}>
            Cerrar sesion
          </button>
          <button type="button" className="outline-button" onClick={openPatientCreate}>
            Nuevo paciente
          </button>
          <button type="button" className="outline-button" onClick={openBudgetCreate}>
            Presupuesto
          </button>
          <button type="button" className="primary-button" onClick={openTreatmentCreate}>
            Atencion rapida
          </button>
        </div>
      </header>

      <section className="control-bar">
        <div className="control-bar__nav">
          <div className="view-switcher">
            <button type="button" className={`nav-toggle ${activeView === "home" ? "is-active" : ""}`} onClick={() => setActiveView("home")}>
              Inicio
            </button>
            <button type="button" className={`nav-toggle ${activeView === "alerts" ? "is-active" : ""}`} onClick={() => setActiveView("alerts")}>
              Alertas
            </button>
            <button
              type="button"
              className={`nav-toggle ${activeView === "finance" ? "is-active" : ""}`}
              onClick={() => setActiveView("finance")}
            >
              Finanzas
            </button>
            <button
              type="button"
              className={`nav-toggle ${activeView === "marketing" ? "is-active" : ""}`}
              onClick={() => setActiveView("marketing")}
            >
              Marketing
            </button>
          </div>

          <button
            type="button"
            className={`nav-toggle nav-toggle--priority ${activeView === "patients" ? "is-active" : ""}`}
            onClick={() => setActiveView("patients")}
          >
            Pacientes
          </button>
        </div>

        <div className="period-picker" ref={periodPickerRef}>
          <button
            type="button"
            className={`period-trigger ${showPeriodPanel ? "is-active" : ""}`}
            aria-expanded={showPeriodPanel}
            aria-haspopup="dialog"
            onClick={() => setShowPeriodPanel((current) => !current)}
          >
            <span className="period-trigger__label">Periodo</span>
            <span className="period-trigger__value">{periodLabel}</span>
          </button>

          {showPeriodPanel ? (
            <div className="period-popover" role="dialog" aria-label="Seleccion del periodo">
              <label className="month-control month-control--compact">
                <span>Desde</span>
                <input type="month" value={periodStartMonth} onChange={(event) => handlePeriodStartChange(event.target.value)} />
              </label>
              <label className="month-control month-control--compact">
                <span>Hasta</span>
                <input type="month" value={periodEndMonth} onChange={(event) => handlePeriodEndChange(event.target.value)} />
              </label>
            </div>
          ) : null}
        </div>
      </section>

      <main className="app-stage">{renderMainView()}</main>

      {modalConfig}
      {deleteConfig ? (
        <ConfirmModal
          title={deleteConfig.title}
          message={deleteConfig.message}
          confirmLabel={deleteConfig.confirmLabel}
          onClose={closeModals}
          onConfirm={handleDeleteConfirmed}
        />
      ) : null}
    </div>
  );
}
