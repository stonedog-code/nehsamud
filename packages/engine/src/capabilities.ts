/**
 * Provider-agnostic capability flags for the MUD process.
 *
 * Mirrors the Python `services/ai/ai_keys.py` resolution order so
 * the wire shape returned by `GET /capabilities` is unchanged across
 * the Python → Node migration. apps/web reads this endpoint on
 * MUD-game mount to decide whether to render the room-image side
 * panel; downstream Node game code reads the same flags before
 * dispatching to text/image generators.
 *
 * Resolution order for each capability:
 *   1. Generic env var (`LLM_API_KEY`, `IMAGE_GEN_API_KEY`)
 *   2. Legacy provider-specific env var (`GEMINI_API_KEY`,
 *      `STABILITY_AI_KEY`) — kept so rollouts from older secret
 *      blobs keep working through the rename.
 *
 * Empty string is treated as unset because the Lightsail deployment
 * template uses `""` placeholders that don't get substituted when
 * the corresponding secret is absent.
 */

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function getTextGenerationKey(): string | undefined {
  return nonEmptyEnv("LLM_API_KEY") ?? nonEmptyEnv("GEMINI_API_KEY");
}

export function getImageGenerationKey(): string | undefined {
  return nonEmptyEnv("IMAGE_GEN_API_KEY") ?? nonEmptyEnv("STABILITY_AI_KEY");
}

export function hasTextGeneration(): boolean {
  return getTextGenerationKey() !== undefined;
}

export function hasImageGeneration(): boolean {
  return getImageGenerationKey() !== undefined;
}

export interface Capabilities {
  textGeneration: boolean;
  imageGeneration: boolean;
}

export function currentCapabilities(): Capabilities {
  return {
    textGeneration: hasTextGeneration(),
    imageGeneration: hasImageGeneration(),
  };
}
