/**
 * Provider-agnostic text generator interface.
 *
 * The application layer never reaches into the SDK directly; it
 * asks `generate(prompt)` and gets back a single string response.
 * Failures (provider down, rate limited, network) are signaled by
 * throwing — callers decide whether to retry or fall back to
 * canned responses.
 *
 * Phase 6 ships a single concrete implementation (Gemini) but the
 * interface lets a future provider swap in without touching
 * callsites.
 */

import { trace } from "@opentelemetry/api";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { withSpan } from "../telemetry/spans.js";

export interface TextGenerator {
  /** One-shot prompt → completion. The provider implementation
   * decides on the model. */
  generate(prompt: string): Promise<string>;
}

export interface GeminiTextGeneratorOptions {
  apiKey: string;
  /** Override the model name. Default: gemini-1.5-flash, matching
   * the Python code path the focused rewrite is replacing. */
  model?: string;
  /** Optional hard ceiling on generation time. Default 8s, which
   * is short enough that an LLM hang doesn't visibly stall the
   * dialog UI but long enough that healthy responses complete. */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "gemini-1.5-flash";
const DEFAULT_TIMEOUT_MS = 8000;

export class GeminiTextGenerator implements TextGenerator {
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiTextGeneratorOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey);
    this.modelName = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(prompt: string): Promise<string> {
    const tracer = trace.getTracer("hopper-mud.ai");
    return withSpan(
      tracer,
      "mud.ai.text.generate",
      {
        "ai.provider": "gemini",
        "ai.model": this.modelName,
        "ai.prompt.length": prompt.length,
      },
      async () => {
        const model = this.client.getGenerativeModel({ model: this.modelName });
        const generation = model.generateContent(prompt);
        const result = await withTimeout(generation, this.timeoutMs);
        const text = result.response.text().trim();
        if (text.length === 0) {
          throw new Error("text generator returned empty response");
        }
        return text;
      },
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`text generation timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
