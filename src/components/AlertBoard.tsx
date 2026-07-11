import {
  filterAlerts,
  getAlertCounts,
  getAlertSubtitle,
  getBucketLabel,
  getBucketTone,
  getDuePill
} from "../lib/dashboard";
import type { AlertFilter, ClinicAlert } from "../types/clinic";

interface AlertBoardProps {
  alerts: ClinicAlert[];
  activeFilter: AlertFilter;
  onChangeFilter: (filter: AlertFilter) => void;
  onOpenPatient: (patientId: string) => void;
}

const filterOrder: AlertFilter[] = ["all", "vencido", "today", "next7", "next30", "future"];

export function AlertBoard({
  alerts,
  activeFilter,
  onChangeFilter,
  onOpenPatient
}: AlertBoardProps) {
  const visibleAlerts = filterAlerts(alerts, activeFilter);
  const counts = getAlertCounts(alerts);
  const allCount = alerts.length;

  return (
    <section className="surface-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Alertas clínicas</p>
          <h2>Controles y recordatorios</h2>
        </div>
        <span className="status-pill status-pill--neutral">{allCount} activas</span>
      </div>

      <div className="filter-grid">
        {filterOrder.map((filter) => {
          const count =
            filter === "all"
              ? allCount
              : filter === "vencido"
                ? counts.vencido
                : filter === "today"
                  ? counts.today
                  : filter === "next7"
                    ? counts.next7
                    : filter === "next30"
                      ? counts.next30
                      : counts.future;

          return (
            <button
              key={filter}
              type="button"
              className={`filter-pill ${activeFilter === filter ? "is-active" : ""}`}
              onClick={() => onChangeFilter(filter)}
            >
              <span>{getBucketLabel(filter)}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="stack-list">
        {visibleAlerts.length > 0 ? (
          visibleAlerts.map((alert) => (
            <article key={alert.id} className="list-card">
              <div className="list-card__content">
                <div className="list-card__title-row">
                  <h3>{alert.patientName}</h3>
                  <span className={`status-pill status-pill--${getBucketTone(alert.bucket)}`}>
                    {getDuePill(alert)}
                  </span>
                </div>
                <p className="list-card__subtitle">{getAlertSubtitle(alert)}</p>
                <p className="list-card__meta">
                  {alert.source}
                  {alert.notes ? ` · ${alert.notes}` : ""}
                </p>
              </div>
              <button type="button" className="ghost-button" onClick={() => onOpenPatient(alert.patientId)}>
                Abrir ficha
              </button>
            </article>
          ))
        ) : (
          <div className="empty-panel">
            <p>No hay alertas para este filtro.</p>
          </div>
        )}
      </div>
    </section>
  );
}
