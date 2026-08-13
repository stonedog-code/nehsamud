/**
 * createAiServices reflects whichever capability keys are set on
 * this process. Same env-precedence rules as /capabilities.
 */

import { createAiServices } from "../ai/factory.js";

const TRACKED = [
  "LLM_API_KEY",
  "GEMINI_API_KEY",
  "IMAGE_GEN_API_KEY",
  "STABILITY_AI_KEY",
] as const;

describe("createAiServices", () => {
  const originals: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of TRACKED) {
      originals[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of TRACKED) {
      if (originals[k] === undefined) delete process.env[k];
      else process.env[k] = originals[k];
    }
  });

  it("returns an empty struct when no provider keys are set", () => {
    const services = createAiServices();
    expect(services.text).toBeUndefined();
    expect(services.image).toBeUndefined();
  });

  it("populates .text when LLM_API_KEY is set", () => {
    process.env.LLM_API_KEY = "x";
    const services = createAiServices();
    expect(services.text).toBeDefined();
    expect(typeof services.text?.generate).toBe("function");
    expect(services.image).toBeUndefined();
  });

  it("populates .text via the legacy GEMINI_API_KEY fallback", () => {
    process.env.GEMINI_API_KEY = "legacy";
    const services = createAiServices();
    expect(services.text).toBeDefined();
  });

  it("populates .image when IMAGE_GEN_API_KEY is set", () => {
    process.env.IMAGE_GEN_API_KEY = "y";
    const services = createAiServices();
    expect(services.image).toBeDefined();
    expect(typeof services.image?.generate).toBe("function");
  });

  it("populates both when both keys are set", () => {
    process.env.LLM_API_KEY = "x";
    process.env.IMAGE_GEN_API_KEY = "y";
    const services = createAiServices();
    expect(services.text).toBeDefined();
    expect(services.image).toBeDefined();
  });
});
