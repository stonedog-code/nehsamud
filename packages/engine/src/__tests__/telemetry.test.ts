/**
 * Telemetry — manual span emission.
 *
 * Strategy: inject a SimpleSpanProcessor + InMemorySpanExporter
 * into initTelemetry() so the test can assert what spans the
 * production code actually emits without standing up a real
 * collector. Each test resets the exporter between runs.
 *
 * Covers:
 *   - OTEL_ENABLED=false short-circuit (no shutdown work, no spans).
 *   - command dispatch wraps the handler in a `mud.command.dispatch`
 *     span with verb + user attributes.
 *   - AI text generator wraps generate() in a `mud.ai.text.generate`
 *     span, even when the underlying provider call throws (span
 *     status flips to ERROR).
 *   - withSpan ends the span on both resolve AND reject so we don't
 *     leak unfinished spans on error paths.
 */

import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";

import { GeminiTextGenerator } from "../ai/text-generator.js";
import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import { initTelemetry } from "../telemetry/setup.js";
import { withSpan } from "../telemetry/spans.js";
import type { SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedRoom } from "../world/world-state.js";

function buildWorld(): WorldState {
  const square: CachedRoom = {
    id: "room-square",
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description: "A modest square at the heart of Townsmee.",
    exits: { north: "room-inn" },
    environment: "townsmee",
    area: "townsmee",
    imageName: null,
  };
  const w = new WorldState();
  w.hydrate([square], []);
  return w;
}

function sessionAt(roomId: string): SessionState {
  return {
    userId: "user-1",
    currentRoomId: roomId,
    currentHp: 30,
    maxHp: 30,
    experience: 0,
    level: 1,
    inventory: [],
    defeated: false,
    resting: false,
  };
}

describe("telemetry / initTelemetry", () => {
  let savedEnabled: string | undefined;

  beforeEach(() => {
    savedEnabled = process.env.OTEL_ENABLED;
  });
  afterEach(async () => {
    if (savedEnabled === undefined) delete process.env.OTEL_ENABLED;
    else process.env.OTEL_ENABLED = savedEnabled;
    // Make sure each test starts with no global provider registered
    // — otherwise the second test sees stale spans from the first.
    trace.disable();
  });

  it("OTEL_ENABLED=false returns a no-op handle", async () => {
    process.env.OTEL_ENABLED = "false";
    const handle = initTelemetry();
    // Calling startSpan on the no-op tracer should not throw and
    // shutdown should resolve cleanly with no underlying SDK.
    const span = handle.tracer.startSpan("noop");
    span.end();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("registers a provider that exports spans through the injected exporter", async () => {
    const exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    const span = handle.tracer.startSpan("test.span");
    span.setAttribute("kind", "unit");
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("test.span");
    await handle.shutdown();
  });
});

describe("telemetry / dispatch spans", () => {
  let exporter: InMemorySpanExporter;
  let shutdown: () => Promise<void>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    shutdown = handle.shutdown;
  });
  afterEach(async () => {
    await shutdown();
    trace.disable();
  });

  it("wraps each command in a mud.command.dispatch span with verb + user attrs", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");
    const tracer = trace.getTracer("hopper-mud");

    await dispatch({
      world,
      session,
      command: parseCommand("look"),
      tracer,
    });

    const spans = exporter.getFinishedSpans();
    const dispatchSpan = spans.find(
      (s: ReadableSpan) => s.name === "mud.command.dispatch",
    );
    expect(dispatchSpan).toBeDefined();
    expect(dispatchSpan?.attributes["mud.command.verb"]).toBe("look");
    expect(dispatchSpan?.attributes["mud.user.id"]).toBe("user-1");
    expect(dispatchSpan?.attributes["mud.room.id"]).toBe("room-square");
  });

  it("does NOT emit a dispatch span when tracer is omitted", async () => {
    const world = buildWorld();
    const session = sessionAt("room-square");

    await dispatch({
      world,
      session,
      command: parseCommand("look"),
    });

    const spans = exporter.getFinishedSpans();
    expect(
      spans.find((s: ReadableSpan) => s.name === "mud.command.dispatch"),
    ).toBeUndefined();
  });
});

describe("telemetry / AI generator spans", () => {
  let exporter: InMemorySpanExporter;
  let shutdown: () => Promise<void>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    shutdown = handle.shutdown;
  });
  afterEach(async () => {
    await shutdown();
    trace.disable();
  });

  it("emits a mud.ai.text.generate span around GeminiTextGenerator.generate, even on failure", async () => {
    // The constructor accepts a fake API key; we never actually
    // reach the network because the underlying SDK throws when
    // there's no real model wired up. We don't care about the
    // result — we care that a span is recorded with ERROR status.
    const gen = new GeminiTextGenerator({
      apiKey: "test-key",
      timeoutMs: 50,
    });
    await expect(gen.generate("hello")).rejects.toBeDefined();

    const spans = exporter.getFinishedSpans();
    const aiSpan = spans.find(
      (s: ReadableSpan) => s.name === "mud.ai.text.generate",
    );
    expect(aiSpan).toBeDefined();
    expect(aiSpan?.attributes["ai.provider"]).toBe("gemini");
    // SpanStatusCode.ERROR = 2; on failure we recorded the
    // exception and set ERROR status.
    expect(aiSpan?.status.code).toBe(2);
  });
});

describe("telemetry / withSpan", () => {
  let exporter: InMemorySpanExporter;
  let shutdown: () => Promise<void>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const handle = initTelemetry({
      exporter,
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
    shutdown = handle.shutdown;
  });
  afterEach(async () => {
    await shutdown();
    trace.disable();
  });

  it("ends the span and sets OK status when the work resolves", async () => {
    const tracer = trace.getTracer("test");
    await withSpan(tracer, "ok.span", { foo: "bar" }, async () => "done");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("ok.span");
    expect(spans[0]?.attributes.foo).toBe("bar");
    // OK = 1
    expect(spans[0]?.status.code).toBe(1);
  });

  it("ends the span AND rethrows when the work throws", async () => {
    const tracer = trace.getTracer("test");
    await expect(
      withSpan(tracer, "bad.span", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("bad.span");
    // ERROR = 2
    expect(spans[0]?.status.code).toBe(2);
    expect(spans[0]?.events.some((e) => e.name === "exception")).toBe(true);
  });
});
