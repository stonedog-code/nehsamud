/**
 * Provider-agnostic image generator interface.
 *
 * Phase 6 ships a thin Stability AI implementation alongside the
 * text generator so the dispatcher can route room-art generation
 * the same way it routes NPC dialog. The actual room-image
 * generation hook lands later (Phase 7+ persistence loop is the
 * natural place to trigger + store the result on the MudRoom
 * row); shipping the client now keeps the AI layer cohesive.
 *
 * Failures throw — callers swallow and continue without art.
 */

import { trace } from "@opentelemetry/api";

import { withSpan } from "../telemetry/spans.js";

export interface ImageGenerator {
  /**
   * Generate a single image for the prompt. Returns the raw PNG
   * bytes; callers are responsible for saving / uploading.
   */
  generate(prompt: string): Promise<Buffer>;
}

export interface StabilityImageGeneratorOptions {
  apiKey: string;
  /** Default Stability model — keep parity with the Python
   * implementation that the focused rewrite replaces. */
  model?: string;
  /** Timeout ceiling. Image generation is meaningfully slower
   * than text, so we allow longer than the text default. */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "sd3-large-turbo";
const DEFAULT_TIMEOUT_MS = 30000;
const ENDPOINT = "https://api.stability.ai/v2beta/stable-image/generate/sd3";

export class StabilityImageGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: StabilityImageGeneratorOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(prompt: string): Promise<Buffer> {
    const tracer = trace.getTracer("hopper-mud.ai");
    return withSpan(
      tracer,
      "mud.ai.image.generate",
      {
        "ai.provider": "stability",
        "ai.model": this.model,
        "ai.prompt.length": prompt.length,
      },
      async () => {
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("model", this.model);
        form.append("output_format", "png");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.apiKey}`,
              accept: "image/*",
            },
            body: form,
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Stability ${res.status}: ${body.slice(0, 200)}`);
          }
          const arrayBuffer = await res.arrayBuffer();
          return Buffer.from(arrayBuffer);
        } finally {
          clearTimeout(timer);
        }
      },
    );
  }
}
