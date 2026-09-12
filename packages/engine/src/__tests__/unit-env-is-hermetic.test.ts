/**
 * The unit tier must not inherit OTEL configuration from the shell.
 *
 * Regression guard for a harness that exports a config blob around the
 * test run: with `OTEL_ENABLED=false` ambient, `initTelemetry()` returned a
 * no-op handle despite the injected exporter, and every span-asserting test
 * failed with 0 spans. `jest.setup.unit.cjs` scrubs `OTEL_*` before each
 * file; this suite fails if that scrub is ever unwired.
 *
 * It can only catch the regression when the shell actually carries an OTEL
 * variable, so it is exercised both ways:
 *   OTEL_ENABLED=false npx jest unit-env-is-hermetic
 *   npx jest unit-env-is-hermetic
 */

import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { initTelemetry } from "../telemetry/setup.js";

describe("unit tier — ambient OTEL configuration is scrubbed", () => {
  afterEach(() => {
    trace.disable();
  });

  it("sees no OTEL_* variable from the shell", () => {
    const leaked = Object.keys(process.env).filter((k) =>
      k.startsWith("OTEL_"),
    );
    expect(leaked).toEqual([]);
  });

  it("initTelemetry with an injected exporter really records spans", async () => {
    const exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    handle.tracer.startSpan("hermetic.probe").end();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      "hermetic.probe",
    ]);
    await handle.shutdown();
  });
});
