/**
 * Unit-tier environment scrub — runs before every unit test file.
 *
 * The unit tier must give the same verdict on a bare shell and inside a
 * wrapper that exports a whole config blob (HopperGuard's
 * `secrets exec --env dev --`, which carries `OTEL_ENABLED=false` and
 * `OTEL_SERVICE_NAME`). `initTelemetry()` honours `OTEL_ENABLED=false` by
 * returning a no-op handle *before* it looks at an injected exporter, so an
 * ambient `false` silently turned every span-asserting test into
 * "0 spans recorded" — six failures that had nothing to do with the code.
 *
 * So the unit tier owns its OTEL configuration: every `OTEL_*` variable is
 * removed here, and a test that wants one sets it itself (see the
 * `OTEL_ENABLED=false` case in telemetry.test.ts). Jest gives each test
 * file its own copy of `process.env`, so this never leaks into the shell.
 *
 * Guarded by src/__tests__/unit-env-is-hermetic.test.ts.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("OTEL_")) delete process.env[key];
}
