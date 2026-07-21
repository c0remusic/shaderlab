/** Outer applications may provide durable logging; rendering stays usable without one. */
export type DiagnosticLogger = (message: string) => void;

export const noopDiagnosticLogger: DiagnosticLogger = () => {};
