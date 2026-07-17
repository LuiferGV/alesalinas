import { useEffect, useMemo } from "react";
import { formatDate, formatGs } from "../lib/date";
import { clinicProfile } from "../lib/clinicProfile";
import type { BudgetEntry, Patient } from "../types/clinic";

interface BudgetPrintPreviewProps {
  patient: Patient;
  budget: BudgetEntry;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
}

const clinicData = {
  professionalName: clinicProfile.professionalName,
  specialty: clinicProfile.specialty,
  brandInitials: clinicProfile.brandInitials,
  address: clinicProfile.address,
  phone: clinicProfile.phone,
  whatsapp: clinicProfile.whatsapp
};

function buildPrintRows(budget: BudgetEntry) {
  const rows = [...budget.items];
  while (rows.length < 8) {
    rows.push({
      id: `blank-${rows.length}`,
      quantity: 0,
      detail: "",
      unitPrice: 0,
      totalPrice: 0
    });
  }
  return rows;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPrintDocument(patient: Patient, budget: BudgetEntry, rows: ReturnType<typeof buildPrintRows>) {
  const note = budget.note || "Presupuesto sujeto a reevaluacion clinica segun evolucion del caso.";
  const [primaryInitial, secondaryInitial] = clinicData.brandInitials;
  const tableRows = rows
    .map(
      (item) => `
        <div class="budget-row ${item.detail ? "has-content" : ""}">
          <span>${item.detail ? escapeHtml(String(item.quantity)) : ""}</span>
          <span>${item.detail ? escapeHtml(item.detail) : ""}</span>
          <span>${item.detail ? escapeHtml(formatGs(item.unitPrice)) : ""}</span>
          <strong>${item.detail ? escapeHtml(formatGs(item.totalPrice)) : ""}</strong>
        </div>
      `
    )
    .join("");
  const clinicLines = [
    clinicData.address ? `<span>${escapeHtml(clinicData.address)}</span>` : "",
    clinicData.phone
      ? `<span class="clinic-line"><span>Telefono:</span><strong>${escapeHtml(clinicData.phone)}</strong></span>`
      : "",
    clinicData.whatsapp
      ? `<span class="clinic-line"><span>WhatsApp:</span><strong>${escapeHtml(clinicData.whatsapp)}</strong></span>`
      : ""
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(budget.budgetNumber)} - Presupuesto</title>
    <style>
      @page {
        size: A4 portrait;
        margin: 8mm;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #17324a;
        font-family: "Segoe UI", Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        padding: 0;
      }

      .sheet {
        width: 100%;
        min-height: 0;
        padding: 10mm 10mm 12mm;
        background: #ffffff;
      }

      .header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 62mm;
        align-items: start;
        gap: 10mm;
      }

      .brand {
        display: grid;
        justify-items: start;
        align-content: start;
        gap: 3mm;
        max-width: 120mm;
      }

      .brand-mark {
        display: flex;
        align-items: baseline;
        gap: 1.2mm;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 15mm;
        font-weight: 800;
        line-height: 0.85;
        letter-spacing: -0.09em;
      }

      .brand-mark-dark {
        color: #111111;
      }

      .brand-mark-gold {
        color: #c9951b;
      }

      .eyebrow {
        margin: 0;
        color: #525252;
        font-size: 3.2mm;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: 0;
      }

      h1 {
        margin: 0;
        color: #111111;
        font-size: 6.3mm;
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }

      .clinic {
        display: grid;
        justify-items: end;
        gap: 2mm;
        text-align: right;
        color: #454545;
        font-size: 3.8mm;
        line-height: 1.35;
      }

      .clinic > strong,
      .clinic-line strong {
        color: #111111;
      }

      .clinic > strong {
        font-size: 4.2mm;
      }

      .clinic-line {
        display: inline-flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 1.5mm;
        white-space: nowrap;
      }

      .meta {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 3mm;
        margin-top: 7mm;
      }

      .meta-card,
      .notes,
      .totals {
        display: grid;
        gap: 1.5mm;
        padding: 4mm;
        border-radius: 4mm;
        border: 0.35mm solid #d8d8d8;
        background: #f4f4f4;
      }

      .meta-card span,
      .meta-card small,
      .notes span,
      .totals span {
        color: #5b5b5b;
      }

      .meta-card strong {
        color: #111111;
        font-size: 4.2mm;
      }

      .budget-table {
        display: grid;
        margin-top: 6mm;
        border-radius: 4mm;
        overflow: hidden;
        border: 0.35mm solid #d2d2d2;
      }

      .budget-table-head,
      .budget-row {
        display: grid;
        grid-template-columns: 22mm minmax(0, 1fr) 32mm 32mm;
      }

      .budget-table-head {
        background: #121212;
        color: #ffffff;
        font-size: 2.75mm;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .budget-table-head span,
      .budget-row span,
      .budget-row strong {
        padding: 3.4mm 4mm;
        border-right: 0.3mm solid #d8d8d8;
      }

      .budget-table-head span {
        overflow: hidden;
        line-height: 1.2;
      }

      .budget-table-head span:last-child,
      .budget-row strong:last-child {
        border-right: none;
      }

      .budget-body {
        display: grid;
      }

      .budget-row {
        min-height: 12mm;
        border-top: 0.3mm solid #d8d8d8;
        background: #ffffff;
        font-size: 4mm;
      }

      .budget-row strong {
        color: #111111;
      }

      .footer {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(72mm, 0.85fr);
        gap: 4mm;
        margin-top: 6mm;
      }

      .notes span,
      .totals span {
        font-size: 3.2mm;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .notes p {
        margin: 0;
        color: #222222;
        line-height: 1.55;
        font-size: 4mm;
      }

      .totals > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 3mm;
      }

      .totals strong {
        color: #111111;
        white-space: nowrap;
        font-size: 4.4mm;
      }

      .totals .grand {
        display: grid;
        grid-template-columns: 1fr;
        gap: 2mm;
        padding-top: 3mm;
        border-top: 0.3mm solid #d2d2d2;
      }

      .totals .grand strong {
        justify-self: end;
        font-size: 6mm;
        line-height: 1.05;
        text-align: right;
      }
    </style>
  </head>
  <body>
    <article class="sheet">
      <header class="header">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span class="brand-mark-dark">${escapeHtml(primaryInitial)}</span>
            <span class="brand-mark-gold">${escapeHtml(secondaryInitial)}</span>
          </div>
          <p class="eyebrow">${escapeHtml(clinicData.specialty)}</p>
          <div class="title-row">
            <h1>Presupuesto</h1>
          </div>
        </div>

        <div class="clinic">
          <strong>${escapeHtml(clinicData.professionalName)}</strong>
          ${clinicLines}
        </div>
      </header>

      <section class="meta">
        <div class="meta-card">
          <span>Numero</span>
          <strong>${escapeHtml(budget.budgetNumber)}</strong>
        </div>
        <div class="meta-card">
          <span>Fecha</span>
          <strong>${escapeHtml(formatDate(budget.createdAt))}</strong>
        </div>
        <div class="meta-card">
          <span>Valido hasta</span>
          <strong>${escapeHtml(formatDate(budget.validUntil))}</strong>
        </div>
        <div class="meta-card">
          <span>Destinatario</span>
          <strong>${escapeHtml(patient.fullName)}</strong>
          <small>${escapeHtml(patient.phone || "Sin telefono")}</small>
        </div>
      </section>

      <section class="budget-table">
        <div class="budget-table-head">
          <span>Cant.</span>
          <span>Detalle del tratamiento</span>
          <span>Precio unitario</span>
          <span>Total</span>
        </div>
        <div class="budget-body">
          ${tableRows}
        </div>
      </section>

      <section class="footer">
        <div class="notes">
          <span>Observacion</span>
          <p>${escapeHtml(note)}</p>
        </div>

        <div class="totals">
          <div>
            <span>Validez</span>
            <strong>${escapeHtml(`${budget.validityDays} dias`)}</strong>
          </div>
          <div class="grand">
            <span>Total presupuestado</span>
            <strong>${escapeHtml(formatGs(budget.totalAmount))}</strong>
          </div>
        </div>
      </section>
    </article>

    <script>
      window.addEventListener("load", () => {
        window.setTimeout(() => {
          window.focus();
          window.print();
        }, 250);
      });

      window.addEventListener("afterprint", () => {
        window.close();
      });
    </script>
  </body>
</html>`;
}

export function BudgetPrintPreview({
  patient,
  budget,
  onClose,
  onEdit,
  onDuplicate
}: BudgetPrintPreviewProps) {
  const [primaryInitial, secondaryInitial] = clinicData.brandInitials;
  const printRows = useMemo(() => buildPrintRows(budget), [budget]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=1100,height=900");
    if (!printWindow) {
      window.alert("No se pudo abrir la ventana de impresion. Revisa si el navegador bloqueo la ventana emergente.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintDocument(patient, budget, printRows));
    printWindow.document.close();
  };

  return (
    <div className="modal-shell budget-print-portal" role="presentation">
      <button type="button" className="modal-backdrop" aria-label="Cerrar vista de impresion" onClick={onClose} />

      <section className="budget-preview" role="dialog" aria-modal="true" aria-labelledby="budget-print-title">
        <header className="budget-preview__chrome">
          <div>
            <p className="eyebrow">Impresion</p>
            <h2 id="budget-print-title">Presupuesto listo para imprimir</h2>
            <p className="modal-card__subtitle">
              La ficha guarda solo los datos. Esta hoja se arma recien para vista previa y papel.
            </p>
          </div>

          <div className="budget-preview__actions">
            <button type="button" className="outline-button" onClick={onDuplicate}>
              Duplicar
            </button>
            <button type="button" className="outline-button" onClick={onEdit}>
              Editar
            </button>
            <button type="button" className="outline-button" onClick={onClose}>
              Cerrar
            </button>
            <button type="button" className="primary-button" onClick={handlePrint}>
              Imprimir
            </button>
          </div>
        </header>

        <article className="budget-sheet">
          <header className="budget-sheet__header">
            <div className="budget-sheet__brand">
              <div className="budget-sheet__brand-mark" aria-hidden="true">
                <span className="budget-sheet__brand-mark-dark">{primaryInitial}</span>
                <span className="budget-sheet__brand-mark-gold">{secondaryInitial}</span>
              </div>
              <div className="budget-sheet__brand-copy">
                <p className="budget-sheet__eyebrow">{clinicData.specialty}</p>
                <div className="budget-sheet__title-row">
                  <h1>Presupuesto</h1>
                </div>
              </div>
            </div>

            <div className="budget-sheet__clinic">
              <strong>{clinicData.professionalName}</strong>
              {clinicData.address ? <span>{clinicData.address}</span> : null}
              {clinicData.phone ? (
                <span className="budget-sheet__clinic-line">
                  <span>Telefono:</span>
                  <strong>{clinicData.phone}</strong>
                </span>
              ) : null}
              {clinicData.whatsapp ? (
                <span className="budget-sheet__clinic-line">
                  <span>WhatsApp:</span>
                  <strong>{clinicData.whatsapp}</strong>
                </span>
              ) : null}
            </div>
          </header>

          <section className="budget-sheet__meta">
            <div className="budget-sheet__meta-card">
              <span>Numero</span>
              <strong>{budget.budgetNumber}</strong>
            </div>
            <div className="budget-sheet__meta-card">
              <span>Fecha</span>
              <strong>{formatDate(budget.createdAt)}</strong>
            </div>
            <div className="budget-sheet__meta-card">
              <span>Valido hasta</span>
              <strong>{formatDate(budget.validUntil)}</strong>
            </div>
            <div className="budget-sheet__meta-card">
              <span>Destinatario</span>
              <strong>{patient.fullName}</strong>
              <small>{patient.phone || "Sin telefono"}</small>
            </div>
          </section>

          <section className="budget-sheet__table">
            <div className="budget-sheet__table-head">
              <span>Cant.</span>
              <span>Detalle del tratamiento</span>
              <span>Precio unitario</span>
              <span>Total</span>
            </div>

            <div className="budget-sheet__table-body">
              {printRows.map((item) => (
                <div key={item.id} className={`budget-sheet__row ${item.detail ? "has-content" : ""}`}>
                  <span>{item.detail ? item.quantity : ""}</span>
                  <span>{item.detail}</span>
                  <span>{item.detail ? formatGs(item.unitPrice) : ""}</span>
                  <strong>{item.detail ? formatGs(item.totalPrice) : ""}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="budget-sheet__footer">
            <div className="budget-sheet__notes">
              <span>Observacion</span>
              <p>{budget.note || "Presupuesto sujeto a reevaluacion clinica segun evolucion del caso."}</p>
            </div>

            <div className="budget-sheet__totals">
              <div>
                <span>Validez</span>
                <strong>{budget.validityDays} dias</strong>
              </div>
              <div className="is-grand">
                <span>Total presupuestado</span>
                <strong>{formatGs(budget.totalAmount)}</strong>
              </div>
            </div>
          </section>
        </article>
      </section>
    </div>
  );
}
