import { useEffect, useMemo, useState } from "react";

type FieldType = "text" | "tel" | "date" | "textarea" | "select" | "number" | "search-select" | "checkbox";
type FieldOption = string | { label: string; value: string };

export interface ModalField {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: FieldOption[];
  min?: number;
  step?: string;
  rows?: number;
  suggestions?: string[];
}

interface EntityModalProps {
  title: string;
  subtitle?: string;
  submitLabel: string;
  fields: ModalField[];
  initialValues: Record<string, string>;
  transformValues?: (
    nextValues: Record<string, string>,
    changedField: string,
    previousValues: Record<string, string>
  ) => Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}

export function EntityModal({
  title,
  subtitle,
  submitLabel,
  fields,
  initialValues,
  transformValues,
  onSubmit,
  onClose
}: EntityModalProps) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const modalId = useMemo(() => `modal-${Math.random().toString(36).slice(2, 9)}`, []);
  const [searchDrafts, setSearchDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.type === "search-select")
        .map((field) => {
          const selected = (field.options ?? []).find((option) =>
            (typeof option === "string" ? option : option.value) === initialValues[field.name]
          );
          const label = selected ? (typeof selected === "string" ? selected : selected.label) : "";
          return [field.name, label];
        })
    )
  );
  const [openSearchField, setOpenSearchField] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleChange = (name: string, value: string) => {
    setValues((current) => {
      const nextValues = {
        ...current,
        [name]: value
      };

      return transformValues ? transformValues(nextValues, name, current) : nextValues;
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const missingSearchField = fields.find(
      (field) => field.type === "search-select" && field.required && !values[field.name]
    );
    if (missingSearchField) {
      window.alert(`Debes seleccionar un valor valido para ${missingSearchField.label}.`);
      return;
    }

    onSubmit(values);
  };

  const getOptionValue = (option: FieldOption) => (typeof option === "string" ? option : option.value);
  const getOptionLabel = (option: FieldOption) => (typeof option === "string" ? option : option.label);

  return (
    <div className="modal-shell" role="presentation">
      <button type="button" className="modal-backdrop" aria-label="Cerrar modal" onClick={onClose} />

      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby={modalId}>
        <header className="modal-card__header">
          <div>
            <p className="eyebrow">Gestion</p>
            <h2 id={modalId}>{title}</h2>
            {subtitle ? <p className="modal-card__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="modal-form__grid">
            {fields.map((field) => {
              const value = values[field.name] ?? "";

              if (field.type === "textarea") {
                return (
                  <label key={field.name} className="modal-field modal-field--full">
                    <span>{field.label}</span>
                    <textarea
                      rows={field.rows ?? 4}
                      value={value}
                      placeholder={field.placeholder}
                      required={field.required}
                      onChange={(event) => handleChange(field.name, event.target.value)}
                    />
                  </label>
                );
              }

              if (field.type === "select") {
                return (
                  <label key={field.name} className="modal-field">
                    <span>{field.label}</span>
                    <select
                      value={value}
                      required={field.required}
                      onChange={(event) => handleChange(field.name, event.target.value)}
                    >
                      {(field.options ?? []).map((option) => (
                        <option
                          key={typeof option === "string" ? option : option.value}
                          value={typeof option === "string" ? option : option.value}
                        >
                          {typeof option === "string" ? option : option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (field.type === "search-select") {
                const options = field.options ?? [];
                const draft = searchDrafts[field.name] ?? "";
                const filteredOptions = options.filter((option) =>
                  getOptionLabel(option).toLowerCase().includes(draft.trim().toLowerCase())
                );

                return (
                  <label key={field.name} className="modal-field">
                    <span>{field.label}</span>
                    <div className="modal-search">
                      <input
                        type="search"
                        value={draft}
                        placeholder={field.placeholder}
                        required={field.required}
                        onFocus={() => setOpenSearchField(field.name)}
                        onBlur={() => {
                          window.setTimeout(() => setOpenSearchField((current) => (current === field.name ? null : current)), 120);
                        }}
                        onChange={(event) => {
                          const nextDraft = event.target.value;
                          setSearchDrafts((current) => ({
                            ...current,
                            [field.name]: nextDraft
                          }));

                          const exact = options.find(
                            (option) => getOptionLabel(option).toLowerCase() === nextDraft.trim().toLowerCase()
                          );

                          handleChange(field.name, exact ? getOptionValue(exact) : "");
                          setOpenSearchField(field.name);
                        }}
                      />

                      {openSearchField === field.name && filteredOptions.length > 0 ? (
                        <div className="modal-search__results">
                          {filteredOptions.slice(0, 8).map((option) => (
                            <button
                              key={getOptionValue(option)}
                              type="button"
                              className="modal-search__option"
                              onClick={() => {
                                handleChange(field.name, getOptionValue(option));
                                setSearchDrafts((current) => ({
                                  ...current,
                                  [field.name]: getOptionLabel(option)
                                }));
                                setOpenSearchField(null);
                              }}
                            >
                              {getOptionLabel(option)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              }

              if (field.type === "checkbox") {
                return (
                  <label key={field.name} className="modal-field modal-field--checkbox">
                    <input
                      type="checkbox"
                      checked={value === "true"}
                      onChange={(event) => handleChange(field.name, event.target.checked ? "true" : "false")}
                    />
                    <span>{field.label}</span>
                  </label>
                );
              }

              return (
                <label key={field.name} className="modal-field">
                  <span>{field.label}</span>
                  <input
                    list={field.suggestions && field.suggestions.length > 0 ? `${modalId}-${field.name}-suggestions` : undefined}
                    type={field.type}
                    value={value}
                    placeholder={field.placeholder}
                    required={field.required}
                    min={field.min}
                    step={field.step}
                    onChange={(event) => handleChange(field.name, event.target.value)}
                  />
                  {field.suggestions && field.suggestions.length > 0 ? (
                    <datalist id={`${modalId}-${field.name}-suggestions`}>
                      {field.suggestions.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                      ))}
                    </datalist>
                  ) : null}
                </label>
              );
            })}
          </div>

          <footer className="modal-card__footer">
            <button type="button" className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary-button">
              {submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
