import type { FormEvent } from "react";
import logoWhite from "../../zzzalewhite.png";
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
  const title =
    sessionState === "not-configured" ? "Configuracion pendiente" : "Bienvenida";
  const subtitle =
    sessionState === "not-configured"
      ? "Faltan algunos datos para habilitar el acceso al sistema."
      : "Ingresa con tu email y contrasena para entrar al panel.";

  const helperText =
    sessionState === "loading"
      ? "Comprobando si ya hay una sesion abierta..."
      : sessionState === "error"
        ? "No pudimos validar el acceso en este momento."
        : "Acceso reservado para el consultorio.";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="auth-shell">
      <div className="page-backdrop" />

      <section className="auth-stage">
        <div className="auth-hero">
          <img className="auth-logo" src={logoWhite} alt={clinicProfile.appName} />
          <p className="eyebrow">{clinicProfile.specialty}</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="auth-highlights">
            <article className="quick-card">
              <strong>Pacientes y seguimientos</strong>
              <span>Accede rapido a fichas, controles, alertas y notas del consultorio.</span>
            </article>
            <article className="quick-card">
              <strong>Finanzas y presupuestos</strong>
              <span>Consulta cobros, gastos y presupuestos desde un mismo panel.</span>
            </article>
          </div>
        </div>

        <section className="auth-card">
          <p className="eyebrow">Ingreso</p>
          <h2>Iniciar sesion</h2>
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
