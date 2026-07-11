import { useEffect, useMemo } from "react";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose
}: ConfirmModalProps) {
  const modalId = useMemo(() => `confirm-${Math.random().toString(36).slice(2, 9)}`, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="modal-shell" role="presentation">
      <button type="button" className="modal-backdrop" aria-label="Cerrar modal" onClick={onClose} />

      <section className="modal-card modal-card--confirm" role="dialog" aria-modal="true" aria-labelledby={modalId}>
        <header className="modal-card__header">
          <div>
            <p className="eyebrow">Confirmacion</p>
            <h2 id={modalId}>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <p className="modal-card__subtitle">{message}</p>

        <footer className="modal-card__footer">
          <button type="button" className="outline-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
