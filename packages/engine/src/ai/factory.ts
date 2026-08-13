/**
 * AI services factory. Reads the capability resolver and returns
 * the configured generator instances — or `undefined` when the
 * corresponding key isn't set.
 *
 * The command processor consumes the result through `AiServices`
 * (a struct of optionals) rather than constructing providers
 * itself, keeping the dispatcher independent of which provider
 * happens to be installed.
 */

import {
  getImageGenerationKey,
  getTextGenerationKey,
} from "../capabilities.js";
import {
  GeminiTextGenerator,
  type TextGenerator,
} from "./text-generator.js";
import {
  StabilityImageGenerator,
  type ImageGenerator,
} from "./image-generator.js";

export interface AiServices {
  text?: TextGenerator;
  image?: ImageGenerator;
}

/**
 * Build the AI services struct from the resolved capability keys.
 *
 * - If `LLM_API_KEY` (or legacy `GEMINI_API_KEY`) is set, `.text`
 *   is a usable GeminiTextGenerator.
 * - If `IMAGE_GEN_API_KEY` (or legacy `STABILITY_AI_KEY`) is set,
 *   `.image` is a usable StabilityImageGenerator.
 * - Otherwise the field is undefined and callers fall back to
 *   canned / no-art behavior.
 */
export function createAiServices(): AiServices {
  const services: AiServices = {};
  const textKey = getTextGenerationKey();
  if (textKey) {
    services.text = new GeminiTextGenerator({ apiKey: textKey });
  }
  const imageKey = getImageGenerationKey();
  if (imageKey) {
    services.image = new StabilityImageGenerator({ apiKey: imageKey });
  }
  return services;
}
