import { useEffect, useState } from "react";
import {
  hasFirebaseCoreConfig,
  registerWithEmail,
  sendResetPasswordEmail,
  signIn,
  signOutSession,
  subscribeAuth
} from "../lib/firebase";

type SessionState = "not-configured" | "loading" | "signed-out" | "authenticated" | "error";

interface FirebaseSessionState {
  sessionState: SessionState;
  userEmail: string | null;
  authError: string | null;
  isSubmitting: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

function getAuthErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  if (code === "auth/invalid-email") return "El email no tiene un formato valido.";
  if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
    return "El email o la contrasena no coinciden.";
  }
  if (code === "auth/email-already-in-use") return "Ese email ya esta siendo usado por otra cuenta.";
  if (code === "auth/weak-password") return "La contrasena debe tener al menos 6 caracteres.";
  if (code === "auth/missing-password") return "Ingresa una contrasena para continuar.";
  if (code === "auth/missing-email") return "Ingresa un email para continuar.";
  if (code === "auth/user-disabled") return "Este usuario fue deshabilitado.";
  if (code === "auth/too-many-requests") return "Hay demasiados intentos. Espera un momento y prueba otra vez.";
  if (code === "auth/operation-not-allowed") return "El acceso por email y contrasena no esta habilitado en Firebase.";
  if (code === "auth/network-request-failed") return "No se pudo conectar con Firebase. Revisa tu internet y vuelve a intentar.";
  return "No se pudo iniciar sesion. Revisa el email, la contrasena y la configuracion del sistema.";
}

export function useFirebaseSession(): FirebaseSessionState {
  const [sessionState, setSessionState] = useState<SessionState>(
    hasFirebaseCoreConfig() ? "loading" : "not-configured"
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!hasFirebaseCoreConfig()) return undefined;

    setSessionState("loading");

    const unsubscribe = subscribeAuth(
      (user) => {
        setUserEmail(user?.email ?? null);
        setSessionState(user ? "authenticated" : "signed-out");
        setAuthError(null);
      },
      (error) => {
        console.error("No se pudo validar la sesion", error);
        setSessionState("error");
        setAuthError("No se pudo validar la sesion.");
      }
    );

    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await signIn(email, password);
      return true;
    } catch (error) {
      console.error("Error al iniciar sesion", error);
      setSessionState("signed-out");
      setAuthError(getAuthErrorMessage(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const register = async (email: string, password: string) => {
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await registerWithEmail(email, password);
      return true;
    } catch (error) {
      console.error("Error al crear la cuenta", error);
      setSessionState("signed-out");
      setAuthError(getAuthErrorMessage(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetPassword = async (email: string) => {
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await sendResetPasswordEmail(email);
      return true;
    } catch (error) {
      console.error("Error al enviar el correo de recuperacion", error);
      setSessionState("signed-out");
      setAuthError(getAuthErrorMessage(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const logout = async () => {
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await signOutSession();
    } catch (error) {
      console.error("Error al cerrar sesion", error);
      setSessionState("error");
      setAuthError("No se pudo cerrar la sesion.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    sessionState,
    userEmail,
    authError,
    isSubmitting,
    login,
    register,
    resetPassword,
    logout
  };
}
