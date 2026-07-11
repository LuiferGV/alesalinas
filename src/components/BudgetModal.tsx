import { useEffect, useMemo, useState } from "react";
import { buildBudgetValidUntil } from "../lib/budgets";
import { formatDate, formatGs } from "../lib/date";
import type { BudgetStatus } from "../types/clinic";

interface PatientOption {
  label: string;
  value: string;
}

export interface BudgetLineItemForm {
  id: string;
  quantity: string;
  detail: string;
  unitPrice: string;
}

export interface BudgetFormValues {
  patientTarget: string;
  status: BudgetStatus;
  createdAt: string;
  validityDays: "15" | "30";
  validUntil: string;
  note: string;
  items: BudgetLineItemForm[];
}

interface BudgetModalProps {
  title: string;
  subtitle?: string;
  submitLabel: string;
  patientOptions: PatientOption[];
  initialValues: BudgetFormValues;
  lockPatient?: boolean;
  lockedPatientLabel?: string;
  onSubmit: (values: BudgetFormValues, intent: "save" | "print") => void;
  onClose: () => void;
}

function createBudgetLineItem(): BudgetLineItemForm {
  return {
    id: `budget-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quantity: "1",
    detail: "",
    unitPrice: ""
  };
}

function toNumber(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function BudgetModal({
  title,
  subtitle,
  submitLabel,
  patientOptions,
  initialValues,
  lockPatient = false,
  lockedPatientLabel,
  onSubmit,
  onClose
}: BudgetModalProps) {
  const modalId = useMemo(() => `budget-${Math.random().toString(36).slice(2, 9)}`, []);
  const [values, setValues] = useState<BudgetFormValues>(() => ({
    ...initialValues,
    validUntil: buildBudgetValidUntil(initialValues.createdAt, Number(initialValues.validityDays) === 30 ? 30 : 15)
  }));
  const [patientDraft, setPatientDraft] = useState(() => {
    const selected = patientOptions.find((option) => option.value === initialValues.patientTarget);
    return selected?.label ?? "";
  });
  const [showPatientResults, setShowPatientResults] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const filteredPatients = patientOptions.filter((option) =>
    option.label.toLowerCase().includes(patientDraft.trim().toLowerCase())
  );

  const budgetItems = useMemo(
    () =>
      values.items.map((item) => {
        const quantity = Math.max(toNumber(item.quantity), 0);
        const unitPrice = Math.max(toNumber(item.unitPrice), 0);
        return {
          ...item,
          quantity,
          unitPrice,
          totalPrice: quantity * unitPrice
        };
      }),
    [values.items]
  );

  const totalAmount = useMemo(() => budgetItems.reduce((sum, item) => sum + item.totalPrice, 0), [budgetItems]);

  const updateValues = (updater: (current: BudgetFormValues) => BudgetFormValues) => {
    setValues((current) => {
      const nextValues = updater(current);
      const validityDays = Number(nextValues.validityDays) === 30 ? 30 : 15;
      return {
        ...nextValues,
        validUntil: buildBudgetValidUntil(nextValues.createdAt, validityDays)
      };
    });
  };

  const updateItem = (itemId: string, field: keyof BudgetLineItemForm, nextValue: string) => {
    updateValues((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, [field]: nextValue } : item))
    }));
  };

  const addItem = () => {
    updateValues((current) => ({
      ...current,
      items: [...current.items, createBudgetLineItem()]
    }));
  };

  const removeItem = (itemId: string) => {
    updateValues((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.id !== itemId) : current.items
    }));
  };

  const submitBudget = (intent: "save" | "print") => {
    if (!values.patientTarget) {
      window.alert("Debes elegir un paciente para este presupuesto.");
      return;
    }

    const cleanItems = values.items.filter((item) => item.detail.trim() && toNumber(item.quantity) > 0);
    if (cleanItems.length === 0) {
      window.alert("Agrega al menos una fila con cantidad y detalle.");
      return;
    }

    onSubmit(
      {
        ...values,
        items: cleanItems
      },
      intent
    );
  };

  const handleSubmit = (intent: "save" | "print") => (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitBudget(intent);
  };

  return (
    <div className="modal-shell" role="presentation">
      <button type="button" className="modal-backdrop" aria-label="Cerrar modal" onClick={onClose} />

      <section className="modal-card budget-modal" role="dialog" aria-modal="true" aria-labelledby={modalId}>
        <header className="modal-card__header">
          <div>
            <p className="eyebrow">Presupuesto</p>
            <h2 id={modalId}>{title}</h2>
            {subtitle ? <p className="modal-card__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSubmit("save")}>
          <div className="budget-form-grid">
            <section className="surface-card surface-card--soft budget-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Destino</p>
                  <h3>Paciente y vigencia</h3>
                </div>
              </div>

              {!lockPatient ? (
                <label className="modal-field">
                  <span>Paciente</span>
                  <div className="modal-search">
                    <input
                      type="search"
                      value={patientDraft}
                      placeholder="Buscar por nombre o telefono"
                      required
                      onFocus={() => setShowPatientResults(true)}
                      onBlur={() => {
                        window.setTimeout(() => setShowPatientResults(false), 120);
                      }}
                      onChange={(event) => {
                        const nextDraft = event.target.value;
                        setPatientDraft(nextDraft);
                        const exact = patientOptions.find(
                          (option) => option.label.toLowerCase() === nextDraft.trim().toLowerCase()
                        );

                        updateValues((current) => ({
                          ...current,
                          patientTarget: exact?.value ?? ""
                        }));
                        setShowPatientResults(true);
                      }}
                    />

                    {showPatientResults && filteredPatients.length > 0 ? (
                      <div className="modal-search__results">
                        {filteredPatients.slice(0, 8).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className="modal-search__option"
                            onClick={() => {
                              setPatientDraft(option.label);
                              updateValues((current) => ({
                                ...current,
                                patientTarget: option.value
                              }));
                              setShowPatientResults(false);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
              ) : (
                <div className="budget-locked-patient">
                  <span>Paciente</span>
                  <strong>{lockedPatientLabel}</strong>
                </div>
              )}

              <div className="budget-inline-grid">
                <label className="modal-field">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={values.createdAt}
                    required
                    onChange={(event) =>
                      updateValues((current) => ({
                        ...current,
                        createdAt: event.target.value
                      }))
                    }
                  />
                </label>

                <label className="modal-field">
                  <span>Validez</span>
                  <select
                    value={values.validityDays}
                    onChange={(event) =>
                      updateValues((current) => ({
                        ...current,
                        validityDays: event.target.value === "30" ? "30" : "15"
                      }))
                    }
                  >
                    <option value="15">15 dias</option>
                    <option value="30">30 dias</option>
                  </select>
                </label>

                <label className="modal-field">
                  <span>Estado</span>
                  <select
                    value={values.status}
                    onChange={(event) =>
                      updateValues((current) => ({
                        ...current,
                        status: event.target.value === "Aprobado" || event.target.value === "Rechazado"
                          ? event.target.value
                          : "Pendiente"
                      }))
                    }
                  >
                    <option value="Pendiente">Pendiente</option>
                    <option value="Aprobado">Aprobado</option>
                    <option value="Rechazado">Rechazado</option>
                  </select>
                </label>
              </div>

              <div className="budget-validity-panel">
                <span>Valido hasta</span>
                <strong>{formatDate(values.validUntil)}</strong>
              </div>

              <label className="modal-field">
                <span>Observacion</span>
                <textarea
                  rows={4}
                  value={values.note}
                  placeholder="Ej.: no incluye rehabilitacion definitiva o cambios segun evaluacion clinica."
                  onChange={(event) =>
                    updateValues((current) => ({
                      ...current,
                      note: event.target.value
                    }))
                  }
                />
              </label>
            </section>

            <section className="surface-card surface-card--soft budget-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Resumen</p>
                  <h3>Total presupuestado</h3>
                </div>
              </div>

              <div className="budget-total-display">
                <span>Total general</span>
                <strong>{formatGs(totalAmount)}</strong>
              </div>

              <div className="budget-validity-panel">
                <span>Estado actual</span>
                <strong>{values.status}</strong>
              </div>

              <div className="stack-list compact-list">
                {budgetItems
                  .filter((item) => item.detail.trim())
                  .map((item) => (
                    <article key={item.id} className="list-card list-card--compact">
                      <div className="list-card__content">
                        <h4>{item.detail}</h4>
                        <p className="list-card__subtitle">
                          {item.quantity} x {formatGs(item.unitPrice)}
                        </p>
                        <p className="list-card__meta">{formatGs(item.totalPrice)}</p>
                      </div>
                    </article>
                  ))}
                {budgetItems.every((item) => !item.detail.trim()) ? (
                  <div className="empty-panel empty-panel--tight">
                    <p>El resumen aparecera mientras cargues las filas del presupuesto.</p>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="budget-items">
            <div className="attention-items__header">
              <div>
                <p className="eyebrow">Items</p>
                <h3>Detalle del tratamiento presupuestado</h3>
              </div>
              <button type="button" className="outline-button" onClick={addItem}>
                Agregar fila
              </button>
            </div>

            <div className="budget-table">
              <div className="budget-table__head">
                <span>Cantidad</span>
                <span>Detalle</span>
                <span>Precio unitario</span>
                <span>Total</span>
                <span />
              </div>

              <div className="budget-table__body">
                {budgetItems.map((item) => (
                  <div key={item.id} className="budget-row">
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={values.items.find((entry) => entry.id === item.id)?.quantity ?? ""}
                      onChange={(event) => updateItem(item.id, "quantity", event.target.value)}
                    />
                    <input
                      type="text"
                      value={values.items.find((entry) => entry.id === item.id)?.detail ?? ""}
                      placeholder="Ej.: 2 caries oclusales"
                      onChange={(event) => updateItem(item.id, "detail", event.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={values.items.find((entry) => entry.id === item.id)?.unitPrice ?? ""}
                      placeholder="150000"
                      onChange={(event) => updateItem(item.id, "unitPrice", event.target.value)}
                    />
                    <strong>{formatGs(item.totalPrice)}</strong>
                    <button
                      type="button"
                      className="danger-button danger-button--ghost"
                      disabled={values.items.length === 1}
                      onClick={() => removeItem(item.id)}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="modal-card__footer">
            <button type="button" className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="ghost-button">
              {submitLabel}
            </button>
            <button type="button" className="primary-button" onClick={() => submitBudget("print")}>
              Guardar e imprimir
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
