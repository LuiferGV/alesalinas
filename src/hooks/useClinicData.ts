import { useEffect, useState } from "react";
import { mockSnapshot } from "../data/mockClinic";
import { hasRealtimeDatabaseConfig, subscribeExpenses, subscribePatients } from "../lib/firebase";
import type { Expense, Patient } from "../types/clinic";

type DataSource = "demo" | "firebase";
type FirebaseState = "not-configured" | "idle" | "loading" | "connected" | "error";

interface ClinicDataState {
  patients: Patient[];
  expenses: Expense[];
  dataSource: DataSource;
  firebaseState: FirebaseState;
}

export function useClinicData(enabled: boolean): ClinicDataState {
  const hasDatabaseConfig = hasRealtimeDatabaseConfig();
  const [patients, setPatients] = useState<Patient[]>(hasDatabaseConfig ? [] : mockSnapshot.patients);
  const [expenses, setExpenses] = useState<Expense[]>(hasDatabaseConfig ? [] : mockSnapshot.expenses);
  const [dataSource, setDataSource] = useState<DataSource>(hasDatabaseConfig ? "firebase" : "demo");
  const [firebaseState, setFirebaseState] = useState<FirebaseState>(
    hasDatabaseConfig ? (enabled ? "loading" : "idle") : "not-configured"
  );

  useEffect(() => {
    if (!hasDatabaseConfig) {
      setPatients(mockSnapshot.patients);
      setExpenses(mockSnapshot.expenses);
      setDataSource("demo");
      setFirebaseState("not-configured");
      return undefined;
    }

    if (!enabled) {
      setPatients([]);
      setExpenses([]);
      setDataSource("firebase");
      setFirebaseState("idle");
      return undefined;
    }

    setFirebaseState("loading");

    const handleError = (error: Error) => {
      console.error("No se pudo conectar con Firebase", error);
      setFirebaseState("error");
    };

    const unsubscribePatients = subscribePatients((nextPatients) => {
      setPatients(nextPatients);
      setDataSource("firebase");
      setFirebaseState("connected");
    }, handleError);

    const unsubscribeExpenses = subscribeExpenses((nextExpenses) => {
      setExpenses(nextExpenses);
    }, handleError);

    return () => {
      unsubscribePatients();
      unsubscribeExpenses();
    };
  }, [enabled, hasDatabaseConfig]);

  return {
    patients,
    expenses,
    dataSource,
    firebaseState
  };
}
