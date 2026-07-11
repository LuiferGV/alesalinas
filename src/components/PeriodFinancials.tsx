import { useState } from "react";
import { MetricCard } from "./MetricCard";
import { formatDate, formatGs } from "../lib/date";
import type { Expense } from "../types/clinic";

type FinancePanel = "income" | "pending" | "expenses" | "net" | null;

interface PendingCollectionItem {
  patientId: string;
  patientName: string;
  concept: string;
  date: string;
  pendingAmount: number;
}

interface CollectedItem {
  patientId: string;
  patientName: string;
  concept: string;
  date: string;
  paidAmount: number;
  method?: string;
}

interface PeriodFinancialsProps {
  incomeAmount: number;
  pendingAmount: number;
  expensesAmount: number;
  netAmount: number;
  pendingCollections: PendingCollectionItem[];
  collectedEntries: CollectedItem[];
  expenses: Expense[];
  onOpenPatient: (patientId: string) => void;
}

export function PeriodFinancials({
  incomeAmount,
  pendingAmount,
  expensesAmount,
  netAmount,
  pendingCollections,
  collectedEntries,
  expenses,
  onOpenPatient
}: PeriodFinancialsProps) {
  const [activePanel, setActivePanel] = useState<FinancePanel>(null);

  const togglePanel = (panel: Exclude<FinancePanel, null>) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const renderPanelContent = () => {
    if (activePanel === "pending") {
      return (
        <div className="panel-subsection">
          <div className="panel-subsection__header">
            <h3>Pendientes de cobro</h3>
            <span>{pendingCollections.length}</span>
          </div>
          <div className="stack-list compact-list">
            {pendingCollections.length > 0 ? (
              pendingCollections.map((item) => (
                <article key={`${item.patientId}-${item.concept}-${item.date}`} className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{item.patientName}</h4>
                    <p className="list-card__subtitle">
                      {item.concept} | {formatDate(item.date)}
                    </p>
                    <p className="list-card__meta">{formatGs(item.pendingAmount)}</p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => onOpenPatient(item.patientId)}>
                    Abrir ficha
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-panel empty-panel--tight">
                <p>Sin pendientes para este periodo.</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activePanel === "income") {
      return (
        <div className="panel-subsection">
          <div className="panel-subsection__header">
            <h3>Cobros del periodo</h3>
            <span>{collectedEntries.length}</span>
          </div>
          <div className="stack-list compact-list">
            {collectedEntries.length > 0 ? (
              collectedEntries.map((item) => (
                <article key={`${item.patientId}-${item.concept}-${item.date}`} className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{item.patientName}</h4>
                    <p className="list-card__subtitle">
                      {item.concept} | {formatDate(item.date)}
                      {item.method ? ` | ${item.method}` : ""}
                    </p>
                    <p className="list-card__meta">{formatGs(item.paidAmount)}</p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => onOpenPatient(item.patientId)}>
                    Abrir ficha
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-panel empty-panel--tight">
                <p>Aun no hay cobros cargados en este periodo.</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activePanel === "expenses") {
      return (
        <div className="panel-subsection">
          <div className="panel-subsection__header">
            <h3>Egresos del periodo</h3>
            <span>{expenses.length}</span>
          </div>
          <div className="stack-list compact-list">
            {expenses.length > 0 ? (
              expenses.map((expense) => (
                <article key={expense.id} className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{expense.concept}</h4>
                    <p className="list-card__subtitle">
                      {expense.category} | {formatDate(expense.date)}
                      {expense.patientName ? ` | ${expense.patientName}` : ""}
                    </p>
                    <p className="list-card__meta">
                      {expense.scope === "patient" ? "Costo asociado a paciente" : "Egreso general del consultorio"}
                    </p>
                    <p className="list-card__meta">{expense.description || "Sin detalle adicional"}</p>
                    <p className="list-card__meta">{formatGs(expense.amount)}</p>
                  </div>
                  {expense.patientId ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        const patientId = expense.patientId;
                        if (!patientId) return;
                        onOpenPatient(patientId);
                      }}
                    >
                      Abrir ficha
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-panel empty-panel--tight">
                <p>Sin egresos generales ni costos de pacientes este mes.</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activePanel === "net") {
      return (
        <div className="dual-column">
          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Balance</p>
                <h2>Neto del periodo</h2>
              </div>
            </div>
            <p className="reading-block">
              {netAmount >= 0
                ? "El periodo esta en positivo segun los cobros efectivos menos los egresos cargados."
                : "El periodo esta en negativo. Conviene revisar pendientes y egresos recientes."}
            </p>
            <div className="mini-metrics">
              <article className="mini-metric">
                <span>Cobrado</span>
                <strong>{formatGs(incomeAmount)}</strong>
              </article>
              <article className="mini-metric">
                <span>Egresos</span>
                <strong>{formatGs(expensesAmount)}</strong>
              </article>
            </div>
          </section>

          <section className="surface-card surface-card--soft">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Lectura rapida</p>
                <h2>Situacion actual</h2>
              </div>
            </div>
            <div className="stack-list compact-list">
              <article className="list-card list-card--compact">
                <div className="list-card__content">
                  <h4>Pendientes abiertos</h4>
                  <p className="list-card__meta">
                    {pendingCollections.length} caso(s) con saldo pendiente por {formatGs(pendingAmount)}.
                  </p>
                </div>
              </article>
              <article className="list-card list-card--compact">
                <div className="list-card__content">
                  <h4>Cobros confirmados</h4>
                  <p className="list-card__meta">
                    {collectedEntries.length} movimiento(s) cobrados en el periodo.
                  </p>
                </div>
              </article>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="empty-panel">
        <p>Toca una placa para ver el detalle de cobros, pendientes, egresos o neto.</p>
      </div>
    );
  };

  return (
    <section className="surface-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Resumen financiero</p>
          <h2>Cobros, pendientes y egresos</h2>
        </div>
      </div>

      <div className="metrics-grid metrics-grid--finance">
        <MetricCard
          label="Cobrado del periodo"
          value={formatGs(incomeAmount)}
          detail="Toca para ver los cobros realizados"
          tone="emerald"
          onClick={() => togglePanel("income")}
          active={activePanel === "income"}
        />
        <MetricCard
          label="Pendiente del periodo"
          value={formatGs(pendingAmount)}
          detail={`${pendingCollections.length} paciente(s) con saldo abierto`}
          tone="ruby"
          onClick={() => togglePanel("pending")}
          active={activePanel === "pending"}
        />
        <MetricCard
          label="Egresos del periodo"
          value={formatGs(expensesAmount)}
          detail="Toca para ver gastos generales y costos por paciente"
          tone="obsidian"
          onClick={() => togglePanel("expenses")}
          active={activePanel === "expenses"}
        />
        <MetricCard
          label="Neto del periodo"
          value={formatGs(netAmount)}
          detail="Toca para ver el balance"
          tone="gold"
          onClick={() => togglePanel("net")}
          active={activePanel === "net"}
        />
      </div>

      <div className="finance-panel">{renderPanelContent()}</div>
    </section>
  );
}
