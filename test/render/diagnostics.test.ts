import { describe, expect, it } from "vitest";
import { noopDiagnosticLogger, type DiagnosticLogger } from "../../src/render/diagnostics";

describe("diagnostics", () => {
  it("provides a callable no-op logger when no outer adapter is configured", () => {
    const logger: DiagnosticLogger = noopDiagnosticLogger;
    expect(() => logger("renderer initialized")).not.toThrow();
  });
});
