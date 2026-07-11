export type FinanceTone = "balanced" | "partial" | "pending" | "review";

export type TreatmentStatus =
  | "Realizado"
  | "Planificado"
  | "Control pendiente"
  | "Cancelado";

export type FollowUpStatus =
  | "Pendiente"
  | "Realizado"
  | "Reprogramado"
  | "Cancelado";

export type FollowUpBucket = "vencido" | "today" | "next7" | "next30" | "future";

export type AlertFilter = "all" | "vencido" | "today" | "next7" | "next30" | "future";

export type PatientTab =
  | "overview"
  | "treatments"
  | "evolution"
  | "followups"
  | "budgets"
  | "finances"
  | "notes";

export type ExpenseScope = "general" | "patient";
export type PaymentMethod = "Efectivo" | "Transferencia" | "Tarjeta" | "QR" | "Otro" | "Importado";
export type MarketingExpenseType = "Agencia" | "Publicidad" | "Contenido" | "Diseno" | "Otro";

export interface PaymentEntry {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod | string;
  note: string;
  fromMarketing?: boolean;
}

export interface Treatment {
  id: string;
  date: string;
  category: string;
  detail: string;
  practitioner: string;
  status: TreatmentStatus;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  note: string;
  linkedFinanceId?: string;
}

export interface EvolutionEntry {
  id: string;
  date: string;
  reason: string;
  findings: string;
  diagnosis: string;
  procedure: string;
  indications: string;
  nextStep: string;
}

export interface FollowUp {
  id: string;
  eventDate: string;
  dueDate: string;
  type: string;
  source: string;
  status: FollowUpStatus;
  notes: string;
}

export interface NoteEntry {
  id: string;
  date: string;
  text: string;
}

export interface BudgetItem {
  id: string;
  quantity: number;
  detail: string;
  unitPrice: number;
  totalPrice: number;
}

export type BudgetStatus = "Pendiente" | "Aprobado" | "Rechazado";

export interface BudgetEntry {
  id: string;
  budgetNumber: string;
  status: BudgetStatus;
  createdAt: string;
  validityDays: 15 | 30;
  validUntil: string;
  note: string;
  items: BudgetItem[];
  totalAmount: number;
}

export interface FinanceEntry {
  id: string;
  date: string;
  concept: string;
  practitioner?: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  description: string;
  linkedTreatmentId?: string;
  payments: PaymentEntry[];
}

export interface Expense {
  id: string;
  date: string;
  concept: string;
  category: string;
  amount: number;
  description: string;
  scope?: ExpenseScope;
  patientId?: string;
  patientName?: string;
  linkedTreatmentId?: string;
  paymentMethod?: PaymentMethod | string;
  vendor?: string;
  marketingType?: MarketingExpenseType | string;
  isMarketing?: boolean;
}

export interface Patient {
  id: string;
  fullName: string;
  phone: string;
  createdAt: string;
  birthDate: string;
  lastVisit: string | null;
  financeTone: FinanceTone;
  occupation: string;
  city: string;
  tags: string[];
  clinicalSummary: string;
  treatments: Treatment[];
  evolutions: EvolutionEntry[];
  followUps: FollowUp[];
  notes: NoteEntry[];
  budgets: BudgetEntry[];
  finances: FinanceEntry[];
  patientExpenses: Expense[];
}

export interface ClinicAlert {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  daysUntilDue: number;
  dueDate: string;
  eventDate: string;
  type: string;
  source: string;
  notes: string;
  bucket: FollowUpBucket;
}

export interface DashboardMetrics {
  patientsCount: number;
  treatmentsCount: number;
  incomeAmount: number;
  pendingAmount: number;
  expensesAmount: number;
  netAmount: number;
  pendingCases: number;
}
