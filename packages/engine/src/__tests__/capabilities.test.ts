/**
 * Mirrors the Python `test_ai_keys.py` coverage so the
 * `/capabilities` endpoint reports identical flags across the
 * migration. apps/web gates UI sections (RoomImage panel today,
 * future NPC-dialog cues) off these booleans.
 */

import {
  currentCapabilities,
  getImageGenerationKey,
  getTextGenerationKey,
  hasImageGeneration,
  hasTextGeneration,
} from "../capabilities.js";

describe("ai capability resolver", () => {
  const keys = [
    "LLM_API_KEY",
    "GEMINI_API_KEY",
    "IMAGE_GEN_API_KEY",
    "STABILITY_AI_KEY",
  ] as const;
  const original: Record<(typeof keys)[number], string | undefined> = {
    LLM_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    IMAGE_GEN_API_KEY: undefined,
    STABILITY_AI_KEY: undefined,
  };

  beforeEach(() => {
    for (const k of keys) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("prefers the generic LLM_API_KEY over the legacy GEMINI_API_KEY", () => {
    process.env.LLM_API_KEY = "new-llm";
    process.env.GEMINI_API_KEY = "legacy-gemini";
    expect(getTextGenerationKey()).toBe("new-llm");
  });

  it("falls back to GEMINI_API_KEY when LLM_API_KEY is unset", () => {
    process.env.GEMINI_API_KEY = "legacy-gemini";
    expect(getTextGenerationKey()).toBe("legacy-gemini");
  });

  it("returns undefined when no text key is set", () => {
    expect(getTextGenerationKey()).toBeUndefined();
  });

  it("prefers the generic IMAGE_GEN_API_KEY over the legacy STABILITY_AI_KEY", () => {
    process.env.IMAGE_GEN_API_KEY = "new-image";
    process.env.STABILITY_AI_KEY = "legacy-stability";
    expect(getImageGenerationKey()).toBe("new-image");
  });

  it("falls back to STABILITY_AI_KEY when IMAGE_GEN_API_KEY is unset", () => {
    process.env.STABILITY_AI_KEY = "legacy-stability";
    expect(getImageGenerationKey()).toBe("legacy-stability");
  });

  it("returns undefined when no image key is set", () => {
    expect(getImageGenerationKey()).toBeUndefined();
  });

  it("treats empty-string env values as unset", () => {
    // Lightsail deploy templates ship `KEY=""` placeholders that never
    // get sed-substituted when the corresponding secret is absent;
    // those must not look configured.
    process.env.LLM_API_KEY = "";
    process.env.GEMINI_API_KEY = "good-fallback";
    expect(getTextGenerationKey()).toBe("good-fallback");
  });

  it("hasTextGeneration and hasImageGeneration mirror the resolved keys", () => {
    expect(hasTextGeneration()).toBe(false);
    expect(hasImageGeneration()).toBe(false);
    process.env.LLM_API_KEY = "x";
    process.env.IMAGE_GEN_API_KEY = "y";
    expect(hasTextGeneration()).toBe(true);
    expect(hasImageGeneration()).toBe(true);
  });

  it("currentCapabilities snapshot matches the resolver flags", () => {
    process.env.LLM_API_KEY = "x";
    expect(currentCapabilities()).toEqual({
      textGeneration: true,
      imageGeneration: false,
    });
  });
});
