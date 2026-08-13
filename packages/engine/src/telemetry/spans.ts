/**
 * Span helpers for the focused-rewrite engine.
 *
 * Two patterns:
 *   1. `withSpan(tracer, name, attrs, fn)` — runs `fn` inside a
 *      span, records exceptions, ends the span on resolve OR
 *      reject. Use for any meaningful unit of work (dispatch,
 *      AI generation, save).
 *   2. `noopTracer()` — return value for code paths where
 *      tracing isn't wanted; functional drop-in for a real
 *      tracer so callers can keep span-wrapping syntax without
 *      special-casing.
 */

import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Tracer,
} from "@opentelemetry/api";

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  });
  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Returns a tracer that creates real spans against the global
 * provider. The global provider is the OpenTelemetry no-op when
 * the SDK hasn't been initialized — calling `startSpan` on it
 * doesn't throw and doesn't ship anything, which is exactly what
 * the test layer wants by default.
 */
export function noopTracer(): Tracer {
  return trace.getTracer("hopper-mud-noop");
}
