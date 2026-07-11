import { useEffect, useRef } from "react";
import {
  buildFinanceCaption,
  getPatientLatestPractitioner,
  getPatientPendingTotal
} from "../lib/dashboard";
import { buildWhatsAppLink, formatDate } from "../lib/date";
import type { Patient } from "../types/clinic";

interface PatientRosterProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  activeLetter: string;
  onActiveLetterChange: (value: string) => void;
  activeDoctor: string;
  onActiveDoctorChange: (value: string) => void;
  availableLetters: string[];
  availableDoctors: string[];
  totalPatients: number;
  patients: Patient[];
  selectedPatientId: string | null;
  onSelectPatient: (patientId: string) => void;
  onDeletePatient: (patientId: string) => void;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2a9.8 9.8 0 0 0-8.46 14.73L2.2 21.8l5.02-1.31A9.8 9.8 0 1 0 12 2.2Zm0 17.81c-1.44 0-2.85-.39-4.08-1.12l-.29-.17-2.98.78.8-2.9-.19-.3a8.05 8.05 0 1 1 6.74 3.71Zm4.42-5.97c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.17-.71-.64-1.2-1.43-1.34-1.67-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.48-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.36.51.57.18 1.08.15 1.49.09.46-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.7 5.29 12 10.59l5.3-5.3 1.41 1.42-5.29 5.29 5.29 5.3-1.41 1.41-5.3-5.29-5.29 5.29-1.42-1.41 5.3-5.3-5.3-5.29 1.41-1.42Z"
      />
    </svg>
  );
}

export function PatientRoster({
  searchTerm,
  onSearchTermChange,
  activeLetter,
  onActiveLetterChange,
  activeDoctor,
  onActiveDoctorChange,
  availableLetters,
  availableDoctors,
  totalPatients,
  patients,
  selectedPatientId,
  onSelectPatient,
  onDeletePatient
}: PatientRosterProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (event.key === "/" && !isEditable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  return (
    <section className="surface-card directory-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Pacientes</p>
          <h2>Directorio del consultorio</h2>
        </div>
        <span className="status-pill status-pill--neutral">
          {patients.length} visibles | {totalPatients} total
        </span>
      </div>

      <div className="directory-toolbar">
        <label className="search-box directory-toolbar__search">
          <div className="search-box__topline">
            <span className="search-box__label">Buscar</span>
            <span className="search-box__hint">Pulsa / para enfocar</span>
          </div>
          <input
            ref={searchInputRef}
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Nombre o telefono"
          />
        </label>

        <label className="roster-select directory-toolbar__filter">
          <span>Doctor tratante</span>
          <select value={activeDoctor} onChange={(event) => onActiveDoctorChange(event.target.value)}>
            <option value="all">Todos los doctores</option>
            {availableDoctors.map((doctor) => (
              <option key={doctor} value={doctor}>
                {doctor}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="directory-filters">
        <div className="alpha-filter">
          <button
            type="button"
            className={`alpha-chip ${activeLetter === "all" ? "is-active" : ""}`}
            onClick={() => onActiveLetterChange("all")}
          >
            Todos
          </button>
          {availableLetters.map((letter) => (
            <button
              key={letter}
              type="button"
              className={`alpha-chip ${activeLetter === letter ? "is-active" : ""}`}
              onClick={() => onActiveLetterChange(letter)}
            >
              {letter}
            </button>
          ))}
        </div>

        {searchTerm || activeLetter !== "all" || activeDoctor !== "all" ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onSearchTermChange("");
              onActiveLetterChange("all");
              onActiveDoctorChange("all");
            }}
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      <div className="directory-table">
        <div className="directory-head" aria-hidden="true">
          <span>Paciente</span>
          <span>Ultima atencion</span>
          <span>Doctor</span>
          <span>Finanzas</span>
          <span>Estado</span>
          <span>Acciones</span>
        </div>

        <div className="directory-list">
          {patients.length > 0 ? (
            patients.map((patient) => {
              const pending = getPatientPendingTotal(patient);
              const statusLabel = pending > 0 ? "Saldo pendiente" : "Al dia";
              const latestPractitioner = getPatientLatestPractitioner(patient) || "Sin doctor asignado";

              return (
                <article
                  key={patient.id}
                  className={`patient-row ${selectedPatientId === patient.id ? "is-selected" : ""}`}
                >
                  <button type="button" className="patient-row__main" onClick={() => onSelectPatient(patient.id)}>
                    <div className="patient-row__primary">
                      <strong>{patient.fullName}</strong>
                      <span>{patient.phone}</span>
                    </div>

                    <div className="patient-row__cell">
                      <span className="patient-row__label">Ultima atencion</span>
                      <span>{formatDate(patient.lastVisit)}</span>
                    </div>

                    <div className="patient-row__cell">
                      <span className="patient-row__label">Doctor</span>
                      <span>{latestPractitioner}</span>
                    </div>

                    <div className="patient-row__cell">
                      <span className="patient-row__label">Finanzas</span>
                      <span>{buildFinanceCaption(patient)}</span>
                    </div>

                    <div className="patient-row__status-wrap">
                      <span className={`patient-row__status ${pending > 0 ? "is-pending" : "is-balanced"}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </button>

                  <div className="patient-row__actions">
                    <a
                      className="icon-circle-button icon-circle-button--whatsapp"
                      href={buildWhatsAppLink(patient.phone)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir WhatsApp de ${patient.fullName}`}
                      title="WhatsApp"
                    >
                      <WhatsAppIcon />
                    </a>

                    <button
                      type="button"
                      className="icon-circle-button icon-circle-button--danger"
                      aria-label={`Eliminar ficha de ${patient.fullName}`}
                      title="Eliminar"
                      onClick={() => onDeletePatient(patient.id)}
                    >
                      <DeleteIcon />
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-panel">
              <p>No encontramos pacientes con esos filtros.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
