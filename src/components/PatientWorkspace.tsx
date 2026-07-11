import { useEffect, useMemo, useState } from "react";
import {
  getBudgetMetaLabel,
  getBudgetStatusClassName,
  getBudgetStatusLabel,
  getBudgetSummary
} from "../lib/budgets";
import {
  getFinanceTimelineLabel,
  getFinanceStatusLabel,
  getPatientExpenseTotal,
  getPatientLatestEvolution,
  getPatientLatestPayment,
  getPatientLatestNote,
  getPatientLatestPractitioner,
  getPatientLatestTreatment,
  getPatientNetCollected,
  getPatientPaidTotal,
  getPatientPendingTotal,
  getPatientProjectedNet,
  getPatientTotalBilled
} from "../lib/dashboard";
import { buildWhatsAppLink, formatDate, formatGs } from "../lib/date";
import type { Patient, PatientTab } from "../types/clinic";

export type RecordKind = "treatment" | "evolution" | "followup" | "budget" | "finance" | "payment" | "expense" | "note";

interface PatientWorkspaceProps {
  patient: Patient | null;
  onEditPatient: (patientId: string) => void;
  onDeletePatient: (patientId: string) => void;
  onCreateRecord: (kind: RecordKind, patientId: string) => void;
  onEditRecord: (kind: RecordKind, patientId: string, itemId: string) => void;
  onDeleteRecord: (kind: RecordKind, patientId: string, itemId: string) => void;
  onPreviewBudget: (patientId: string, budgetId: string) => void;
  onDuplicateBudget: (patientId: string, budgetId: string) => void;
}

const tabs: Array<{ id: PatientTab; label: string }> = [
  { id: "overview", label: "Resumen" },
  { id: "treatments", label: "Tratamientos" },
  { id: "evolution", label: "Evolucion" },
  { id: "followups", label: "Seguimientos" },
  { id: "budgets", label: "Presupuestos" },
  { id: "finances", label: "Finanzas" },
  { id: "notes", label: "Notas" }
];

const createLabels: Record<PatientTab, string> = {
  overview: "Nueva atencion",
  treatments: "Nueva atencion",
  evolution: "Nueva evolucion",
  followups: "Nuevo seguimiento",
  budgets: "Nuevo presupuesto",
  finances: "Registrar pago",
  notes: "Nueva nota"
};

const tabKinds: Record<PatientTab, RecordKind> = {
  overview: "treatment",
  treatments: "treatment",
  evolution: "evolution",
  followups: "followup",
  budgets: "budget",
  finances: "payment",
  notes: "note"
};

export function PatientWorkspace({
  patient,
  onEditPatient,
  onDeletePatient,
  onCreateRecord,
  onEditRecord,
  onDeleteRecord,
  onPreviewBudget,
  onDuplicateBudget
}: PatientWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<PatientTab>("overview");

  useEffect(() => {
    setActiveTab("overview");
  }, [patient?.id]);

  const latestTreatment = useMemo(() => (patient ? getPatientLatestTreatment(patient) : null), [patient]);
  const latestPayment = useMemo(() => (patient ? getPatientLatestPayment(patient) : null), [patient]);
  const latestEvolution = useMemo(() => (patient ? getPatientLatestEvolution(patient) : null), [patient]);
  const latestNote = useMemo(() => (patient ? getPatientLatestNote(patient) : null), [patient]);
  const latestPractitioner = useMemo(() => (patient ? getPatientLatestPractitioner(patient) : null), [patient]);

  if (!patient) {
    return (
      <section className="workspace-card workspace-card--empty">
        <div className="empty-panel">
          <p>Selecciona un paciente para abrir su ficha completa.</p>
        </div>
      </section>
    );
  }

  const billedAmount = getPatientTotalBilled(patient);
  const paidAmount = getPatientPaidTotal(patient);
  const pendingAmount = getPatientPendingTotal(patient);
  const patientExpenseAmount = getPatientExpenseTotal(patient);
  const netCollectedAmount = getPatientNetCollected(patient);
  const projectedNetAmount = getPatientProjectedNet(patient);
  const currentKind = tabKinds[activeTab];
  const hasPendingFinances = patient.finances.some((entry) => entry.pendingAmount > 0);
  const primaryActionDisabled = currentKind === "payment" && !hasPendingFinances;
  const patientExpenses = [...patient.patientExpenses].sort((left, right) => right.date.localeCompare(left.date));

  return (
    <section className="workspace-card">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Ficha del paciente</p>
          <h2>{patient.fullName}</h2>
          <p className="workspace-subtitle">
            {patient.city || "Sin ciudad"} | {patient.occupation || "Sin ocupacion cargada"} | Alta{" "}
            {formatDate(patient.createdAt)}
          </p>
        </div>

        <div className="workspace-actions">
          <a className="outline-button" href={buildWhatsAppLink(patient.phone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <button type="button" className="outline-button" onClick={() => onEditPatient(patient.id)}>
            Editar ficha
          </button>
          {hasPendingFinances ? (
            <button type="button" className="outline-button" onClick={() => onCreateRecord("payment", patient.id)}>
              Registrar pago
            </button>
          ) : null}
          <button type="button" className="danger-button" onClick={() => onDeletePatient(patient.id)}>
            Eliminar ficha
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={primaryActionDisabled}
            onClick={() => onCreateRecord(currentKind, patient.id)}
          >
            {primaryActionDisabled ? "Sin saldos pendientes" : createLabels[activeTab]}
          </button>
        </div>
      </header>

      <div className="profile-strip">
        <article className="profile-chip">
          <span>Telefono</span>
          <strong>{patient.phone}</strong>
        </article>
        <article className="profile-chip">
          <span>Ultima atencion</span>
          <strong>{formatDate(patient.lastVisit)}</strong>
        </article>
        <article className="profile-chip">
          <span>Ultimo doctor</span>
          <strong>{latestPractitioner || "Sin asignar"}</strong>
        </article>
        <article className="profile-chip">
          <span>Saldo pendiente</span>
          <strong>{formatGs(pendingAmount)}</strong>
        </article>
      </div>

      <div className="tag-row">
        {patient.tags.length > 0 ? (
          patient.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))
        ) : (
          <span className="tag-chip">Sin etiquetas</span>
        )}
      </div>

      <div className="workspace-toolbar">
        <nav className="tab-row" aria-label="Secciones de la ficha">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "overview" ? (
        <div className="workspace-grid">
          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Panorama clinico</p>
                <h3>Resumen rapido</h3>
              </div>
            </div>
            <p className="reading-block">{patient.clinicalSummary || "Sin resumen clinico cargado."}</p>
            <div className="mini-metrics">
              <article className="mini-metric">
                <span>Facturado</span>
                <strong>{formatGs(billedAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Cobrado</span>
                <strong>{formatGs(paidAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Pendiente</span>
                <strong>{formatGs(pendingAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Costos</span>
                <strong>{formatGs(patientExpenseAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Utilidad cobrada</span>
                <strong>{formatGs(netCollectedAmount)}</strong>
              </article>
            </div>
          </section>

          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Ultimos movimientos</p>
                <h3>Actividad reciente</h3>
              </div>
            </div>
            <div className="stack-list compact-list">
              {latestTreatment ? (
                <article className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{latestTreatment.detail}</h4>
                    <p className="list-card__subtitle">
                      {latestTreatment.category} | {formatDate(latestTreatment.date)} | {latestTreatment.practitioner || "Sin doctor"}
                    </p>
                    <p className="list-card__meta">
                      {formatGs(latestTreatment.totalAmount)} | Abonado {formatGs(latestTreatment.paidAmount)} | Pendiente{" "}
                      {formatGs(latestTreatment.pendingAmount)}
                    </p>
                  </div>
                </article>
              ) : null}
              {latestEvolution ? (
                <article className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{latestEvolution.reason || "Evolucion clinica"}</h4>
                    <p className="list-card__subtitle">{formatDate(latestEvolution.date)}</p>
                    <p className="list-card__meta">{latestEvolution.findings}</p>
                  </div>
                </article>
              ) : null}
              {latestPayment ? (
                <article className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>Pago registrado</h4>
                    <p className="list-card__subtitle">
                      {latestPayment.concept} | {formatDate(latestPayment.date)}
                    </p>
                    <p className="list-card__meta">
                      {formatGs(latestPayment.amount)}
                      {latestPayment.method ? ` | ${latestPayment.method}` : ""}
                    </p>
                  </div>
                </article>
              ) : null}
              {latestNote ? (
                <article className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>Nota interna</h4>
                    <p className="list-card__subtitle">{formatDate(latestNote.date)}</p>
                    <p className="list-card__meta">{latestNote.text}</p>
                  </div>
                </article>
              ) : null}
              {!latestTreatment && !latestEvolution && !latestPayment && !latestNote ? (
                <div className="empty-panel empty-panel--tight">
                  <p>Aun no hay registros recientes.</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Seguimientos</p>
                <h3>Proximos controles</h3>
              </div>
            </div>
            <div className="stack-list compact-list">
              {patient.followUps.length > 0 ? (
                patient.followUps.map((followUp) => (
                  <article key={followUp.id} className="list-card list-card--compact">
                    <div className="list-card__content">
                      <h4>{followUp.type}</h4>
                      <p className="list-card__subtitle">
                        {formatDate(followUp.dueDate)} | {followUp.status}
                      </p>
                      <p className="list-card__meta">{followUp.source}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-panel empty-panel--tight">
                  <p>Sin seguimientos cargados todavia.</p>
                </div>
              )}
            </div>
          </section>

          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Flujo rapido</p>
                <h3>Atencion y cobro</h3>
              </div>
            </div>
            <div className="quick-grid">
              <button type="button" className="quick-card" onClick={() => onCreateRecord("treatment", patient.id)}>
                <strong>Atencion rapida</strong>
                <span>Tratamiento, cobro, costo y control en una sola carga.</span>
              </button>
              <button
                type="button"
                className="quick-card"
                onClick={() => onCreateRecord("payment", patient.id)}
                disabled={!hasPendingFinances}
              >
                <strong>Registrar pago</strong>
                <span>
                  {hasPendingFinances
                    ? "Anota un abono nuevo y deja historial real de cada pago."
                    : "Este paciente no tiene saldos pendientes ahora mismo."}
                </span>
              </button>
              <button type="button" className="quick-card" onClick={() => onCreateRecord("followup", patient.id)}>
                <strong>Programar control</strong>
                <span>Seguimiento clinico sin salir de la ficha.</span>
              </button>
              <button type="button" className="quick-card" onClick={() => onCreateRecord("budget", patient.id)}>
                <strong>Presupuesto imprimible</strong>
                <span>Carga cantidades y precios una vez, guarda y reimprime cuando quieras.</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "treatments" ? (
        <div className="stack-list">
          {patient.treatments.length > 0 ? (
            patient.treatments.map((treatment) => (
              <article key={treatment.id} className="list-card">
                <div className="list-card__content">
                  <div className="list-card__title-row">
                    <h3>{treatment.detail}</h3>
                    <span className="status-pill status-pill--neutral">{treatment.status}</span>
                  </div>
                  <p className="list-card__subtitle">
                      {treatment.category} | {formatDate(treatment.date)} | {treatment.practitioner || "Sin doctor"}
                  </p>
                  <p className="list-card__meta">
                      Total {formatGs(treatment.totalAmount)} | Abonado {formatGs(treatment.paidAmount)} | Pendiente{" "}
                      {formatGs(treatment.pendingAmount)}
                  </p>
                  <p className="list-card__meta">{treatment.note || "Sin observacion clinica"}</p>
                </div>
                <div className="list-card__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEditRecord("treatment", patient.id, treatment.id)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button danger-button--ghost"
                    onClick={() => onDeleteRecord("treatment", patient.id, treatment.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-panel empty-panel--tight">
              <p>No hay atenciones cargadas todavia.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "evolution" ? (
        <div className="stack-list">
          {patient.evolutions.length > 0 ? (
            patient.evolutions.map((item) => (
              <article key={item.id} className="list-card">
                <div className="list-card__content">
                  <div className="list-card__title-row">
                    <h3>{item.reason || "Evolucion clinica"}</h3>
                    <span className="status-pill status-pill--neutral">{formatDate(item.date)}</span>
                  </div>
                  <p className="list-card__meta">
                    Hallazgos: {item.findings || "Sin detalle"} | Diagnostico: {item.diagnosis || "Sin diagnostico"}
                  </p>
                  <p className="list-card__meta">
                      Procedimiento: {item.procedure || "No especificado"} | Proximo paso: {item.nextStep || "Sin definir"}
                  </p>
                </div>
                <div className="list-card__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEditRecord("evolution", patient.id, item.id)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button danger-button--ghost"
                    onClick={() => onDeleteRecord("evolution", patient.id, item.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-panel empty-panel--tight">
              <p>No hay evoluciones cargadas todavia.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "followups" ? (
        <div className="stack-list">
          {patient.followUps.length > 0 ? (
            patient.followUps.map((followUp) => (
              <article key={followUp.id} className="list-card">
                <div className="list-card__content">
                  <div className="list-card__title-row">
                    <h3>{followUp.type}</h3>
                    <span className="status-pill status-pill--neutral">{followUp.status}</span>
                  </div>
                  <p className="list-card__subtitle">
                    Evento: {formatDate(followUp.eventDate)} | Vence: {formatDate(followUp.dueDate)}
                  </p>
                  <p className="list-card__meta">
                    {followUp.source}
                      {followUp.notes ? ` | ${followUp.notes}` : ""}
                  </p>
                </div>
                <div className="list-card__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEditRecord("followup", patient.id, followUp.id)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button danger-button--ghost"
                    onClick={() => onDeleteRecord("followup", patient.id, followUp.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-panel empty-panel--tight">
              <p>No hay seguimientos cargados todavia.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "budgets" ? (
        <div className="stack-list">
          {patient.budgets.length > 0 ? (
            patient.budgets.map((budget) => (
              <article key={budget.id} className="list-card">
                <div className="list-card__content">
                  <div className="list-card__title-row">
                    <h3>{budget.budgetNumber}</h3>
                    <span className={getBudgetStatusClassName(budget)}>{getBudgetStatusLabel(budget)}</span>
                  </div>
                  <p className="list-card__subtitle">{getBudgetMetaLabel(budget)}</p>
                  <p className="list-card__meta">{getBudgetSummary(budget)}</p>
                  <p className="list-card__meta">
                    {budget.items.length} item(s) | Total {formatGs(budget.totalAmount)}
                  </p>
                </div>
                <div className="list-card__actions">
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => onPreviewBudget(patient.id, budget.id)}
                  >
                    Ver e imprimir
                  </button>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => onDuplicateBudget(patient.id, budget.id)}
                  >
                    Duplicar
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEditRecord("budget", patient.id, budget.id)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button danger-button--ghost"
                    onClick={() => onDeleteRecord("budget", patient.id, budget.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-panel empty-panel--tight">
              <p>No hay presupuestos guardados todavia.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "finances" ? (
        <div className="stack-list">
          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Rentabilidad</p>
                <h3>Resultado del caso</h3>
              </div>
            </div>
            <p className="reading-block">
              Aqui ves lo que facturaste, lo que cobraste, el costo real del paciente y la utilidad del caso.
            </p>
            <div className="mini-metrics">
              <article className="mini-metric">
                <span>Facturado</span>
                <strong>{formatGs(billedAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Cobrado</span>
                <strong>{formatGs(paidAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Pendiente</span>
                <strong>{formatGs(pendingAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Costos del caso</span>
                <strong>{formatGs(patientExpenseAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Utilidad cobrada</span>
                <strong>{formatGs(netCollectedAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Utilidad proyectada</span>
                <strong>{formatGs(projectedNetAmount)}</strong>
              </article>
            </div>
          </section>

          <div className="dual-column">
            <section className="surface-card surface-card--soft">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Movimientos</p>
                  <h3>Deudas, pagos e historial</h3>
                </div>
                <button type="button" className="ghost-button" onClick={() => onCreateRecord("finance", patient.id)}>
                  Nueva deuda
                </button>
              </div>
              <div className="stack-list compact-list">
                {patient.finances.length > 0 ? (
                  patient.finances.map((entry) => (
                    <article key={entry.id} className="list-card list-card--compact">
                      <div className="list-card__content">
                        <h4>{entry.concept}</h4>
                        <p className="list-card__subtitle">
                          {getFinanceTimelineLabel(entry)} | {getFinanceStatusLabel(entry)} | {entry.practitioner || "Sin doctor"}
                        </p>
                        <p className="list-card__meta">
                          Total {formatGs(entry.totalAmount)} | Abonado {formatGs(entry.paidAmount)} | Pendiente{" "}
                          {formatGs(entry.pendingAmount)}
                        </p>
                        <div className="finance-payment-list">
                          {entry.payments.length > 0 ? (
                            entry.payments.map((payment) => (
                              <div key={payment.id} className="finance-payment-row">
                                <strong>{formatGs(payment.amount)}</strong>
                                <span>
                                  {formatDate(payment.date)}
                                  {payment.method ? ` | ${payment.method}` : ""}
                                  {payment.note ? ` | ${payment.note}` : ""}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="list-card__meta">Sin pagos registrados todavia.</p>
                          )}
                        </div>
                      </div>
                      <div className="list-card__actions">
                        {entry.pendingAmount > 0 ? (
                          <button type="button" className="outline-button" onClick={() => onCreateRecord("payment", patient.id)}>
                            Registrar pago
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            entry.linkedTreatmentId
                              ? onEditRecord("treatment", patient.id, entry.linkedTreatmentId)
                              : onEditRecord("finance", patient.id, entry.id)
                          }
                        >
                          {entry.linkedTreatmentId ? "Editar atencion" : "Editar"}
                        </button>
                        <button
                          type="button"
                          className="danger-button danger-button--ghost"
                          onClick={() =>
                            entry.linkedTreatmentId
                              ? onDeleteRecord("treatment", patient.id, entry.linkedTreatmentId)
                              : onDeleteRecord("finance", patient.id, entry.id)
                          }
                        >
                          {entry.linkedTreatmentId ? "Eliminar atencion" : "Eliminar"}
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-panel empty-panel--tight">
                    <p>No hay movimientos financieros cargados todavia.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="surface-card surface-card--soft">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Costos del paciente</p>
                  <h3>Laboratorio, placa e insumos</h3>
                </div>
                <button type="button" className="ghost-button" onClick={() => onCreateRecord("expense", patient.id)}>
                  Nuevo costo
                </button>
              </div>
              <div className="stack-list compact-list">
                {patientExpenses.length > 0 ? (
                  patientExpenses.map((expense) => (
                    <article key={expense.id} className="list-card list-card--compact">
                      <div className="list-card__content">
                        <h4>{expense.concept}</h4>
                        <p className="list-card__subtitle">
                          {expense.category} | {formatDate(expense.date)}
                        </p>
                        <p className="list-card__meta">{expense.description || "Sin detalle del costo"}</p>
                        <p className="list-card__meta">{formatGs(expense.amount)}</p>
                      </div>
                      <div className="list-card__actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => onEditRecord("expense", patient.id, expense.id)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-button danger-button--ghost"
                          onClick={() => onDeleteRecord("expense", patient.id, expense.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-panel empty-panel--tight">
                    <p>No hay costos asociados a este paciente todavia.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {activeTab === "notes" ? (
        <div className="stack-list">
          {patient.notes.length > 0 ? (
            patient.notes.map((entry) => (
              <article key={entry.id} className="list-card">
                <div className="list-card__content">
                  <div className="list-card__title-row">
                    <h3>Nota interna</h3>
                    <span className="status-pill status-pill--neutral">{formatDate(entry.date)}</span>
                  </div>
                  <p className="list-card__meta">{entry.text}</p>
                </div>
                <div className="list-card__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEditRecord("note", patient.id, entry.id)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button danger-button--ghost"
                    onClick={() => onDeleteRecord("note", patient.id, entry.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-panel empty-panel--tight">
              <p>No hay notas cargadas todavia.</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
