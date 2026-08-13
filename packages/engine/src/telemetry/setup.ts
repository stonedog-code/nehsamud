/**
 * OpenTelemetry tracer bootstrap.
 *
 * Phase 8 wires up traces; metrics + logs are deferred (the Python
 * implementation shipped both, but they aren't load-bearing for
 * any current dashboard, so the focused rewrite postpones the
 * wiring until a real consumer needs them).
 *
 * Config (env):
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP HTTP collector URL. When
 *     unset, we still install the SDK but use a no-op exporter
 *     so the tracer API works (manual spans created in user code
 *     don't throw) without trying to ship anything anywhere.
 *   OTEL_SERVICE_NAME — defaults to "hopper-mud" so deploys
 *     without explicit config still appear with a sane name in
 *     downstream tooling.
 *   OTEL_ENABLED — "false" to opt out entirely (no SDK install,
 *     all tracer.startSpan calls become no-ops). Used by the
 *     Phase 9 test suite to avoid SDK pollution across tests.
 *
 * Returns a shutdown handle so the process can flush the export
 * queue on SIGTERM.
 */

import { trace, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

/** Kept as `hopper-mud` deliberately: HopperGuard's monitoring keys off this
 * service name, so renaming it to match this package would silently orphan
 * existing dashboards and alerts. Override per deployment with
 * `OTEL_SERVICE_NAME`. */
const DEFAULT_SERVICE_NAME = "hopper-mud";

export interface TelemetryHandle {
  tracer: Tracer;
  shutdown(): Promise<void>;
}

export interface InitTelemetryOptions {
  /** Override the service name; falls back to OTEL_SERVICE_NAME
   * or the default. */
  serviceName?: string;
  /** Override the OTLP endpoint; falls back to
   * OTEL_EXPORTER_OTLP_ENDPOINT. */
  endpoint?: string;
  /** Inject a custom exporter — Phase 9 integration tests pass
   * an InMemorySpanExporter so they can assert spans without
   * spinning up a real collector. */
  exporter?: SpanExporter;
  /** Inject a custom span processor — for tests that want the
   * synchronous SimpleSpanProcessor instead of the production
   * BatchSpanProcessor. */
  spanProcessor?: SpanProcessor;
}

export function initTelemetry(
  options: InitTelemetryOptions = {},
): TelemetryHandle {
  // OTEL_ENABLED=false opts the process out of all SDK work.
  // The returned tracer is the global no-op tracer; manual span
  // creation in user code is safe (no throws), but spans never
  // surface anywhere.
  if (process.env.OTEL_ENABLED === "false") {
    return {
      tracer: trace.getTracer(DEFAULT_SERVICE_NAME),
      shutdown: async () => undefined,
    };
  }

  const serviceName =
    options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
  const endpoint =
    options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const exporter =
    options.exporter ??
    (endpoint
      ? new OTLPTraceExporter({ url: endpoint })
      : undefined);

  const processor: SpanProcessor =
    options.spanProcessor ??
    (exporter
      ? new BatchSpanProcessor(exporter)
      : new SimpleSpanProcessor(new NoOpExporter()));

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
  });
  provider.addSpanProcessor(processor);
  provider.register();

  return {
    tracer: trace.getTracer(serviceName),
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}

/**
 * No-op exporter for the "OTEL_ENABLED but no endpoint" case —
 * keeps the SDK installed so user code's startSpan works, without
 * actually shipping data anywhere.
 */
class NoOpExporter implements SpanExporter {
  export(_spans: Parameters<SpanExporter["export"]>[0], done: Parameters<SpanExporter["export"]>[1]): void {
    done({ code: 0 });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
