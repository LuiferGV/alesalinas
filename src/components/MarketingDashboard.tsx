import { MetricCard } from "./MetricCard";
import { formatDate, formatGs } from "../lib/date";
import type { Expense } from "../types/clinic";
import type { MarketingIncomeEntry } from "../lib/marketing";

interface MarketingDashboardProps {
  spendAmount: number;
  agencyAmount: number;
  cardAmount: number;
  incomeAmount: number;
  netAmount: number;
  roas: number | null;
  marketingPatientsCount: number;
  expenses: Expense[];
  incomeEntries: MarketingIncomeEntry[];
  onOpenPatient: (patientId: string) => void;
  onCreateExpense: () => void;
  onEditExpense: (expenseId: string) => void;
  onDeleteExpense: (expenseId: string) => void;
}

function formatRoas(roas: number | null) {
  if (roas === null) return "Sin gasto";
  return `${roas.toFixed(2)}x`;
}

export function MarketingDashboard({
  spendAmount,
  agencyAmount,
  cardAmount,
  incomeAmount,
  netAmount,
  roas,
  marketingPatientsCount,
  expenses,
  incomeEntries,
  onOpenPatient,
  onCreateExpense,
  onEditExpense,
  onDeleteExpense
}: MarketingDashboardProps) {
  return (
    <section className="marketing-layout">
      <section className="surface-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Marketing</p>
            <h2>Gastos e ingresos atribuidos</h2>
          </div>
          <button type="button" className="primary-button" onClick={onCreateExpense}>
            Nuevo gasto de marketing
          </button>
        </div>

        <div className="metrics-grid metrics-grid--finance">
          <MetricCard
            label="Gasto total"
            value={formatGs(spendAmount)}
            detail={`${expenses.length} movimiento(s) de marketing en el periodo`}
            tone="obsidian"
          />
          <MetricCard
            label="Pagado a agencia"
            value={formatGs(agencyAmount)}
            detail="Suma de gastos marcados como Agencia"
            tone="gold"
          />
          <MetricCard
            label="Gastado con tarjeta"
            value={formatGs(cardAmount)}
            detail="Solo egresos de marketing pagados con tarjeta"
            tone="ruby"
          />
          <MetricCard
            label="Ingreso por marketing"
            value={formatGs(incomeAmount)}
            detail={`${marketingPatientsCount} paciente(s) con cobros marcados como marketing`}
            tone="emerald"
          />
        </div>
      </section>

      <section className="dual-column">
        <section className="surface-card surface-card--soft">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Cobros</p>
              <h3>Ingresos que llegaron desde marketing</h3>
            </div>
          </div>

          <div className="stack-list compact-list">
            {incomeEntries.length > 0 ? (
              incomeEntries.map((entry) => (
                <article key={`${entry.patientId}-${entry.concept}-${entry.date}-${entry.amount}`} className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{entry.patientName}</h4>
                    <p className="list-card__subtitle">
                      {entry.concept} | {formatDate(entry.date)}
                      {entry.method ? ` | ${entry.method}` : ""}
                    </p>
                    <p className="list-card__meta">{formatGs(entry.amount)}</p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => onOpenPatient(entry.patientId)}>
                    Abrir ficha
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-panel empty-panel--tight">
                <p>Todavia no hay cobros marcados como provenientes de marketing.</p>
              </div>
            )}
          </div>
        </section>

        <section className="surface-card surface-card--soft">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Egresos</p>
              <h3>Agencia, anuncios y otros costos</h3>
            </div>
            <button type="button" className="ghost-button" onClick={onCreateExpense}>
              Cargar gasto
            </button>
          </div>

          <div className="stack-list compact-list">
            {expenses.length > 0 ? (
              expenses.map((expense) => (
                <article key={expense.id} className="list-card list-card--compact">
                  <div className="list-card__content">
                    <h4>{expense.concept}</h4>
                    <p className="list-card__subtitle">
                      {expense.marketingType || "Marketing"} | {formatDate(expense.date)}
                      {expense.vendor ? ` | ${expense.vendor}` : ""}
                    </p>
                    <p className="list-card__meta">
                      {expense.paymentMethod ? `Pago por ${expense.paymentMethod}` : "Metodo no especificado"}
                    </p>
                    <p className="list-card__meta">{expense.description || "Sin detalle adicional"}</p>
                    <p className="list-card__meta">{formatGs(expense.amount)}</p>
                  </div>
                  <div className="list-card__actions">
                    <button type="button" className="ghost-button" onClick={() => onEditExpense(expense.id)}>
                      Editar
                    </button>
                    <button type="button" className="danger-button danger-button--ghost" onClick={() => onDeleteExpense(expense.id)}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-panel empty-panel--tight">
                <p>Aun no hay gastos de marketing cargados en este periodo.</p>
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="surface-card surface-card--soft">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Rendimiento</p>
            <h3>Lectura rapida del periodo</h3>
          </div>
        </div>

        <div className="mini-metrics">
          <article className="mini-metric">
            <span>Resultado neto</span>
            <strong>{formatGs(netAmount)}</strong>
          </article>
          <article className="mini-metric">
            <span>ROAS</span>
            <strong>{formatRoas(roas)}</strong>
          </article>
          <article className="mini-metric">
            <span>Pacientes atribuidos</span>
            <strong>{marketingPatientsCount}</strong>
          </article>
          <article className="mini-metric">
            <span>Movimientos cargados</span>
            <strong>{expenses.length + incomeEntries.length}</strong>
          </article>
        </div>

        <p className="reading-block marketing-reading-block">
          {netAmount >= 0
            ? "Marketing esta dejando saldo positivo en este periodo segun los cobros marcados y los gastos cargados."
            : "Marketing esta en negativo en este periodo. Conviene revisar campanas, agencia y pagos con tarjeta."}
        </p>
      </section>
    </section>
  );
}
