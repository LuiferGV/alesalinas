import { useEffect, useState } from "react";
import { hasFirebaseCoreConfig, signIn, signOutSession, subscribeAuth } from "../lib/firebase";

type SessionState = "not-configured" | "loading" | "signed-out" | "authenticated" | "error";

interface FirebaseSessionState {
  sessionState: SessionState;
  userEmail: string | null;
  authError: string | null;
  isSubmitting: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

function getAuthErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  if (code === "auth/invalid-email") return "El email no tiene un formato valido.";
  if (code === "auth/invalid-credential") return "El email o la contrasena no coinciden.";
  if (code === "auth/user-disabled") return "Este usuario fue deshabilitado en Firebase.";
  if (code === "auth/too-many-requests") return "Hay demasiados intentos. Espera un momento y prueba otra vez.";
  return "No se pudo iniciar sesion. Revisa el email, la contrasena y la configuracion de Firebase.";
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
        console.error("No se pudo validar la sesion de Firebase", error);
        setSessionState("error");
        setAuthError("No se pudo validar la sesion con Firebase.");
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
    logout
  };
}
