/**
 * Async room-art generation.
 *
 * When a player enters a room with `imageName === null` and the
 * image generator is configured, fire one generation in the
 * background. The PNG bytes are written to disk under
 * `MUD_IMAGE_DIR` (default `./generated/rooms/`); the file name
 * is stored on `MudRoom.imageName` and propagated into the
 * WorldState cache so subsequent renders pick it up without a
 * DB roundtrip.
 *
 * Deduplication: a per-instance `inFlight` set blocks a second
 * generation for a room that's already generating. Failures
 * silently retry on the next entry; players don't see an error
 * line.
 *
 * Storage strategy: Phase 7 writes to a local directory. Phase 10
 * can swap this for an S3 upload by replacing `writePng`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { PrismaClient } from "@nehsamud/engine-db";

import type { ImageGenerator } from "../ai/image-generator.js";
import type { WorldState } from "../world/world-state.js";

export interface RoomArtGeneratorOptions {
  /** Directory the generator writes PNGs to. Default
   * `./generated/rooms/`, resolved against `process.cwd()`. */
  outputDir?: string;
}

const DEFAULT_OUTPUT_DIR = "./generated/rooms";

export class RoomArtGenerator {
  private readonly inFlight = new Set<string>();
  private readonly outputDir: string;

  constructor(options: RoomArtGeneratorOptions = {}) {
    this.outputDir = resolve(
      process.cwd(),
      options.outputDir ?? DEFAULT_OUTPUT_DIR,
    );
  }

  /**
   * Trigger generation for the room IF:
   *   - The room exists and currently has no imageName
   *   - The image generator is provided
   *   - No prior generation for this room is already in flight
   *
   * Fire-and-forget: the caller doesn't await the underlying
   * generation. The look-after-move response goes out before the
   * PNG lands; the NEXT look (or the next player to enter)
   * picks up the cached name.
   */
  scheduleIfNeeded(
    roomId: string,
    world: WorldState,
    image: ImageGenerator | undefined,
    prisma: PrismaClient,
  ): void {
    if (!image) return;
    if (this.inFlight.has(roomId)) return;
    const room = world.getRoom(roomId);
    if (!room) return;
    if (room.imageName) return;
    this.inFlight.add(roomId);
    void this.generateAndStore(roomId, room.description, image, prisma, world)
      .catch(() => {
        // Swallow: a failed generation will retry next time
        // someone enters the room. We don't surface the error
        // to the player.
      })
      .finally(() => {
        this.inFlight.delete(roomId);
      });
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Test seam — exposed so unit tests can assert the directory
   * resolution works as documented. */
  get resolvedOutputDir(): string {
    return this.outputDir;
  }

  private async generateAndStore(
    roomId: string,
    description: string,
    image: ImageGenerator,
    prisma: PrismaClient,
    world: WorldState,
  ): Promise<void> {
    const prompt = buildRoomPrompt(description);
    const png = await image.generate(prompt);
    await mkdir(this.outputDir, { recursive: true });
    const fileName = `room-${roomId}.png`;
    await writeFile(join(this.outputDir, fileName), png);
    // Update the DB + the in-memory cache.
    await prisma.mudRoom.update({
      where: { id: roomId },
      data: { imageName: fileName },
    });
    const cached = world.getRoom(roomId);
    if (cached) {
      cached.imageName = fileName;
    }
  }
}

function buildRoomPrompt(description: string): string {
  // Same style anchors the Python image service used so a future
  // model swap can A/B compare against the Python output.
  return [
    "Fantasy MUD room illustration, painterly, ink + watercolor.",
    "Renaissance vibe, no people in frame.",
    "Scene:",
    description,
  ].join(" ");
}
