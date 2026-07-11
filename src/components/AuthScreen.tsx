import type { FormEvent } from "react";
import { clinicProfile } from "../lib/clinicProfile";

interface AuthScreenProps {
  email: string;
  password: string;
  sessionState: "not-configured" | "loading" | "signed-out" | "error";
  authError: string | null;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function AuthScreen({
  email,
  password,
  sessionState,
  authError,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit
}: AuthScreenProps) {
  const [primaryInitial, secondaryInitial] = clinicProfile.brandInitials;
  const title =
    sessionState === "not-configured" ? "Falta configurar Firebase" : "Acceso privado del consultorio";
  const subtitle =
    sessionState === "not-configured"
      ? "Carga las variables de Firebase para usar la base real del sistema."
      : "Ingresa con tu email y contrasena para abrir pacientes, atenciones, alertas y finanzas.";

  const helperText =
    sessionState === "loading"
      ? "Verificando si ya existe una sesion activa..."
      : sessionState === "error"
        ? "Firebase respondio con un problema de autenticacion."
        : "Solo los usuarios autorizados pueden entrar al panel clinico.";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="auth-shell">
      <div className="page-backdrop" />

      <section className="auth-stage">
        <div className="auth-hero">
          <p className="eyebrow">{clinicProfile.appName}</p>
          <div className="brand-mark brand-mark--hero" aria-hidden="true">
            <span className="brand-mark__dark">{primaryInitial}</span>
            <span className="brand-mark__gold">{secondaryInitial}</span>
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="auth-highlights">
            <article className="quick-card">
              <strong>Pacientes protegidos</strong>
              <span>La base clinica solo se abre con autenticacion activa en Firebase.</span>
            </article>
            <article className="quick-card">
              <strong>Sincronizacion en tiempo real</strong>
              <span>Todo lo que cargues quedara listo para seguir desde otro equipo o una nueva sesion.</span>
            </article>
          </div>
        </div>

        <section className="auth-card">
          <p className="eyebrow">Ingreso</p>
          <h2>Panel del consultorio</h2>
          <p className="auth-card__subtitle">{helperText}</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="modal-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                placeholder={clinicProfile.loginEmail}
                autoComplete="email"
                disabled={sessionState === "not-configured" || isSubmitting}
                onChange={(event) => onEmailChange(event.target.value)}
              />
            </label>

            <label className="modal-field">
              <span>Contrasena</span>
              <input
                type="password"
                value={password}
                placeholder="Ingresa tu contrasena"
                autoComplete="current-password"
                disabled={sessionState === "not-configured" || isSubmitting}
                onChange={(event) => onPasswordChange(event.target.value)}
              />
            </label>

            {authError ? <p className="auth-form__error">{authError}</p> : null}

            <button
              type="submit"
              className="primary-button auth-form__submit"
              disabled={sessionState === "not-configured" || isSubmitting}
            >
              {isSubmitting ? "Validando acceso..." : "Ingresar al sistema"}
            </button>
          </form>
        </section>
      </section>
    </div>
  );
}
