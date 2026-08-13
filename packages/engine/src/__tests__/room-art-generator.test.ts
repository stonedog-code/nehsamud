/**
 * RoomArtGenerator — schedules generation, dedupes in-flight,
 * silent-fails on provider error. Real file writes use a tmp
 * directory; no Prisma roundtrip (a mocked update is enough).
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImageGenerator } from "../ai/image-generator.js";
import { RoomArtGenerator } from "../persistence/room-art-generator.js";
import type { CachedRoom } from "../world/world-state.js";
import { WorldState } from "../world/world-state.js";

function fakeImage(
  png: Buffer | Error,
  options: { latencyMs?: number } = {},
): ImageGenerator {
  return {
    generate: jest.fn(async () => {
      if (options.latencyMs) {
        await new Promise((r) => setTimeout(r, options.latencyMs));
      }
      if (png instanceof Error) throw png;
      return png;
    }),
  };
}

function buildWorld(): WorldState {
  const square: CachedRoom = {
    id: "room-square",
    enumKey: "TOWNSMEE_TOWNSQUARE",
    name: "Town Square",
    description: "Cobbles.",
    exits: {},
    environment: null,
    imageName: null,
  };
  const inn: CachedRoom = {
    id: "room-inn",
    enumKey: "TOWNSMEE_INN",
    name: "Inn",
    description: "Fire.",
    exits: {},
    environment: null,
    imageName: "room-inn.png", // already rendered
  };
  const w = new WorldState();
  w.hydrate([square, inn], []);
  return w;
}

function fakePrisma() {
  return {
    mudRoom: { update: jest.fn(async () => undefined) },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!predicate()) throw new Error("waitFor timed out");
}

const SQUARE_FILE = "room-room-square.png"; // generator pattern: `room-${roomId}.png`

describe("RoomArtGenerator", () => {
  let outputDir: string;
  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "hoppermud-art-"));
  });
  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it("skips when no generator is configured", () => {
    const w = buildWorld();
    const prisma = fakePrisma();
    const gen = new RoomArtGenerator({ outputDir });
    gen.scheduleIfNeeded(
      "room-square",
      w,
      undefined,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    expect(gen.inFlightCount()).toBe(0);
    expect(prisma.mudRoom.update).not.toHaveBeenCalled();
  });

  it("skips when the room already has imageName", () => {
    const w = buildWorld();
    const prisma = fakePrisma();
    const image = fakeImage(Buffer.from("png-bytes"));
    const gen = new RoomArtGenerator({ outputDir });
    gen.scheduleIfNeeded(
      "room-inn",
      w,
      image,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    expect(gen.inFlightCount()).toBe(0);
    expect(image.generate).not.toHaveBeenCalled();
  });

  it("generates a png, writes it, updates Prisma, and updates the cache", async () => {
    const w = buildWorld();
    const prisma = fakePrisma();
    const png = Buffer.from("the-png-bytes");
    const image = fakeImage(png);
    const gen = new RoomArtGenerator({ outputDir });
    gen.scheduleIfNeeded(
      "room-square",
      w,
      image,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    expect(gen.inFlightCount()).toBe(1);
    await waitFor(() => gen.inFlightCount() === 0);
    expect(image.generate).toHaveBeenCalledTimes(1);
    expect(prisma.mudRoom.update).toHaveBeenCalledTimes(1);
    const update = (prisma.mudRoom.update as jest.Mock).mock.calls[0]?.[0] as {
      where: { id: string };
      data: { imageName: string };
    };
    expect(update.where.id).toBe("room-square");
    expect(update.data.imageName).toBe(SQUARE_FILE);
    expect(w.getRoom("room-square")?.imageName).toBe(SQUARE_FILE);
    const written = readFileSync(join(outputDir, SQUARE_FILE));
    expect(written.equals(png)).toBe(true);
  });

  it("dedupes a second schedule while a generation is in flight", async () => {
    const w = buildWorld();
    const prisma = fakePrisma();
    const image = fakeImage(Buffer.from("x"), { latencyMs: 30 });
    const gen = new RoomArtGenerator({ outputDir });
    gen.scheduleIfNeeded(
      "room-square",
      w,
      image,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    gen.scheduleIfNeeded(
      "room-square",
      w,
      image,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    expect(gen.inFlightCount()).toBe(1);
    await waitFor(() => gen.inFlightCount() === 0);
    expect(image.generate).toHaveBeenCalledTimes(1);
  });

  it("silent-fails on provider error and lets a later schedule retry", async () => {
    const w = buildWorld();
    const prisma = fakePrisma();
    const failingImage = fakeImage(new Error("503"));
    const gen = new RoomArtGenerator({ outputDir });
    gen.scheduleIfNeeded(
      "room-square",
      w,
      failingImage,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    await waitFor(() => gen.inFlightCount() === 0);
    expect(prisma.mudRoom.update).not.toHaveBeenCalled();
    expect(w.getRoom("room-square")?.imageName).toBeNull();
    // A subsequent attempt with a working generator succeeds.
    const goodImage = fakeImage(Buffer.from("retry-png"));
    gen.scheduleIfNeeded(
      "room-square",
      w,
      goodImage,
      prisma as unknown as Parameters<typeof gen.scheduleIfNeeded>[3],
    );
    await waitFor(() => gen.inFlightCount() === 0);
    expect(goodImage.generate).toHaveBeenCalledTimes(1);
    expect(w.getRoom("room-square")?.imageName).toBe(SQUARE_FILE);
  });
});
