import { dispatch } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import { DEFAULT_MAX_HP, SessionRegistry } from "../world/session.js";
import type { SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedRoom } from "../world/world-state.js";

/**
 * Communication verbs, ported from the original Python MUD's
 * core/commands/{say,yell,whisper,who}.py.
 *
 * Until these existed a *multi*-user dungeon had no way for two players to
 * talk: every verb answered only the person who typed it. These tests are
 * mostly about who HEARS what, because that is the part that was missing and
 * the part a single-session test cannot see.
 */

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A square.",
  exits: { north: "room-inn" },
  environment: "townsmee",
  imageName: null,
};
const INN: CachedRoom = {
  id: "room-inn",
  enumKey: "TOWNSMEE_INN",
  name: "The Quiet Bed",
  description: "Warm.",
  exits: { south: "room-square" },
  environment: "townsmee",
  imageName: null,
};
const CELLAR: CachedRoom = {
  id: "room-cellar",
  enumKey: "TOWNSMEE_CELLAR",
  name: "Cellar",
  description: "Cold.",
  exits: {},
  environment: "townsmee",
  imageName: null,
};

function world(): WorldState {
  const w = new WorldState("pve");
  w.hydrate([SQUARE, INN, CELLAR]);
  return w;
}

/** A registry with real sessions, since these verbs are about other people. */
function registryWith(
  entries: Array<{ userId: string; name: string; roomId: string }>,
): { sessions: SessionRegistry; byUser: Map<string, SessionState> } {
  const sessions = new SessionRegistry();
  const byUser = new Map<string, SessionState>();
  for (const e of entries) {
    const socket = {};
    const s = sessions.open(socket, e.userId, e.roomId);
    s.characterName = e.name;
    byUser.set(e.userId, s);
  }
  return { sessions, byUser };
}

const run = async (
  w: WorldState,
  session: SessionState,
  sessions: SessionRegistry,
  input: string,
) =>
  (await dispatch({ world: w, session, sessions, command: parseCommand(input) }))
    .response;

describe("say", () => {
  it("tells the speaker what they said and the room who said it", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "say hello there");

    expect(res.lines.join(" ")).toBe('You say "hello there"');
    expect(res.broadcasts).toEqual([
      {
        scope: "room",
        roomId: SQUARE.id,
        message: 'Aria says "hello there"',
      },
    ]);
  });

  it("keeps the whole message, including spaces and punctuation", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    const res = await run(
      world(),
      byUser.get("u-a")!,
      sessions,
      "say  well, hello there!  ",
    );
    expect(res.lines[0]).toBe('You say "well, hello there!"');
  });

  it("asks what, rather than broadcasting silence", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "say");
    expect(res.lines.join(" ")).toBe("Say what?");
    expect(res.broadcasts).toBeUndefined();
  });

  it("is reachable by the classic ' shortcut, which binds tight", () => {
    // `'hello there` with no space is the MUD convention. It cannot be a
    // whole-token alias, because `'hello` tokenizes as one word.
    expect(parseCommand("'hi")).toEqual({
      verb: "say",
      args: ["hi"],
      rest: "hi",
    });
    expect(parseCommand("'hello there friend").rest).toBe("hello there friend");
    // With a space too, since players type both.
    expect(parseCommand("' hello there").rest).toBe("hello there");
    // A bare apostrophe asks what, rather than saying nothing loudly.
    expect(parseCommand("'")).toEqual({ verb: "say", args: [], rest: "" });
  });
});

describe("yell", () => {
  it("carries content to the room and presence to adjacent rooms", async () => {
    // The distinction that makes yell worth having: neighbours learn that
    // something happened, not what was said.
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "yell help me");

    expect(res.lines[0]).toBe('You yell "help me"');
    const room = res.broadcasts?.find((b) => b.scope === "room");
    const adjacent = res.broadcasts?.find((b) => b.scope === "adjacent");
    expect(room?.message).toBe('Aria yells "help me"');
    expect(adjacent?.message).not.toContain("help me");
    expect(adjacent?.message).toContain("adjacent room");
  });
});

describe("whisper", () => {
  it("does NOT include the target's name in the message", async () => {
    // The original computed the message as command.split(" ", 1)[1], which
    // still contains the target — so "whisper bob hi" delivered "bob hi".
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await run(
      world(),
      byUser.get("u-a")!,
      sessions,
      "whisper Bran meet me later",
    );

    expect(res.lines[0]).toBe('You whisper "meet me later" to Bran.');
    expect(res.broadcasts).toEqual([
      {
        scope: "user",
        userId: "u-b",
        message: 'Aria whispers "meet me later" to you.',
      },
    ]);
  });

  it("reaches only the target, not the room", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
      { userId: "u-c", name: "Cass", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "whisper Bran psst");
    expect(res.broadcasts).toHaveLength(1);
    expect(res.broadcasts![0]!.userId).toBe("u-b");
  });

  it("gives the same answer for absent and elsewhere", async () => {
    // Distinguishing them would turn whisper into a way to locate players you
    // cannot see, which is `who`'s decision to make, not whisper's by accident.
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: INN.id },
    ]);
    const elsewhere = await run(world(), byUser.get("u-a")!, sessions, "whisper Bran hi");
    const absent = await run(world(), byUser.get("u-a")!, sessions, "whisper Nobody hi");
    expect(elsewhere.lines[0]).toContain('no "Bran" here');
    expect(absent.lines[0]).toContain('no "Nobody" here');
    expect(elsewhere.broadcasts).toBeUndefined();
  });

  it("prompts for the missing half rather than guessing", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    expect(
      (await run(world(), byUser.get("u-a")!, sessions, "whisper")).lines[0],
    ).toBe("Whisper to whom?");
    expect(
      (await run(world(), byUser.get("u-a")!, sessions, "whisper Bran")).lines[0],
    ).toBe("Whisper what to Bran?");
  });

  it("is case-insensitive on the target's name", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "whisper bRaN hi");
    expect(res.broadcasts?.[0]?.userId).toBe("u-b");
  });

  it("handles whispering to yourself without echoing", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "whisper Aria hi");
    expect(res.lines[0]).toContain("mutter to yourself");
    expect(res.broadcasts).toBeUndefined();
  });

  it("is reachable as `tell`", async () => {
    expect(parseCommand("tell Bran hi").verb).toBe("whisper");
  });
});

describe("who", () => {
  it("lists everyone online, sorted, and answers the CALLER", async () => {
    // The original shadowed its `player` parameter with the loop variable and
    // sent the list to whichever player happened to be last in the registry.
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Cass", roomId: SQUARE.id },
      { userId: "u-b", name: "Aria", roomId: INN.id },
      { userId: "u-c", name: "Bran", roomId: CELLAR.id },
    ]);
    const res = await run(world(), byUser.get("u-a")!, sessions, "who");

    expect(res.lines[0]).toBe("3 players online:");
    expect(res.lines.slice(1)).toEqual(["  Aria", "  Bran", "  Cass"]);
    // Nobody else is told who asked.
    expect(res.broadcasts).toBeUndefined();
  });

  it("counts players across rooms, not just the caller's", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: INN.id },
    ]);
    expect((await run(world(), byUser.get("u-a")!, sessions, "who")).lines[0]).toBe(
      "2 players online:",
    );
  });

  it("says 1 player, singular, when alone", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    expect((await run(world(), byUser.get("u-a")!, sessions, "who")).lines[0]).toBe(
      "1 player online:",
    );
  });
});

describe("without a session registry", () => {
  it("degrades to nobody-else rather than throwing", async () => {
    // Transport-only harnesses construct a context with no registry. A
    // communication verb must not take the connection down over it.
    const lone: SessionState = {
      userId: "u-a",
      characterName: "Aria",
      currentRoomId: SQUARE.id,
      currentHp: DEFAULT_MAX_HP,
      maxHp: DEFAULT_MAX_HP,
      experience: 0,
      level: 1,
      inventory: [],
      defeated: false,
    resting: false,
    };
    const res = (
      await dispatch({
        world: world(),
        session: lone,
        command: parseCommand("who"),
      })
    ).response;
    expect(res.lines[0]).toBe("1 player online:");

    const whispered = (
      await dispatch({
        world: world(),
        session: lone,
        command: parseCommand("whisper Bran hi"),
      })
    ).response;
    expect(whispered.lines[0]).toContain('no "Bran" here');
  });
});

describe("SessionRegistry lookups", () => {
  it("finds sessions in a room and excludes one", () => {
    const { sessions } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
      { userId: "u-c", name: "Cass", roomId: INN.id },
    ]);
    expect(sessions.inRoom(SQUARE.id).map((s) => s.userId).sort()).toEqual([
      "u-a",
      "u-b",
    ]);
    expect(sessions.inRoom(SQUARE.id, "u-a").map((s) => s.userId)).toEqual(["u-b"]);
  });

  it("finds by character name, falling back to userId", () => {
    const { sessions } = registryWith([
      { userId: "u-a", name: "Aria", roomId: SQUARE.id },
    ]);
    expect(sessions.findByCharacterName("aria")?.userId).toBe("u-a");
    expect(sessions.findByCharacterName("u-a")?.userId).toBe("u-a");
    expect(sessions.findByCharacterName("")).toBeUndefined();
    expect(sessions.findByCharacterName("nobody")).toBeUndefined();
  });
});
