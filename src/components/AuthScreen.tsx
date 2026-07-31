import type { FormEvent } from "react";
import logoWhite from "../../zzzalewhite.png";
import { clinicProfile } from "../lib/clinicProfile";

interface AuthScreenProps {
  email: string;
  password: string;
  sessionState: "not-configured" | "loading" | "signed-out" | "error";
  authMessage: string | null;
  authMessageTone: "error" | "success";
  isSubmitting: boolean;
  allowSelfSignup: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onRegister: () => void;
  onResetPassword: () => void;
}

export function AuthScreen({
  email,
  password,
  sessionState,
  authMessage,
  authMessageTone,
  isSubmitting,
  allowSelfSignup,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onRegister,
  onResetPassword
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

            <button
              type="submit"
              className="primary-button auth-form__submit"
              disabled={sessionState === "not-configured" || isSubmitting}
            >
              {isSubmitting ? "Validando acceso..." : "Ingresar al sistema"}
            </button>

            <div className="auth-form__actions">
              {allowSelfSignup ? (
                <button
                  type="button"
                  className="outline-button auth-form__submit"
                  disabled={sessionState === "not-configured" || isSubmitting}
                  onClick={onRegister}
                >
                  Crear cuenta nueva
                </button>
              ) : null}

              <button
                type="button"
                className="ghost-button auth-form__submit"
                disabled={sessionState === "not-configured" || isSubmitting}
                onClick={onResetPassword}
              >
                Olvide mi contrasena
              </button>
            </div>

            {authMessage ? (
              <p
                className={
                  authMessageTone === "success"
                    ? "auth-form__message auth-form__message--success"
                    : "auth-form__message auth-form__message--error"
                }
              >
                {authMessage}
              </p>
            ) : null}

            {allowSelfSignup ? (
              <p className="auth-form__hint">
                Cualquier persona con la URL podra crear una cuenta mientras este boton siga activo.
              </p>
            ) : null}
          </form>
        </section>
      </section>
    </div>
  );
}
