/**
 * `system` — the operator broadcast verb (NEH-656).
 *
 * Two things are being tested and they are not the same thing: that it
 * reaches everyone when an operator types it, and that a non-operator cannot
 * tell it exists at all. The second is the reason the verb waited for an
 * authorisation model instead of shipping with the other sixteen.
 */

import { dispatch, handlersFor } from "../commands/dispatch.js";
import { parseCommand } from "../commands/parser.js";
import { SessionRegistry } from "../world/session.js";
import type { SessionState } from "../world/session.js";
import { WorldState } from "../world/world-state.js";
import type { CachedRoom } from "../world/world-state.js";

const SQUARE: CachedRoom = {
  id: "room-square",
  enumKey: "TOWNSMEE_TOWNSQUARE",
  name: "Town Square",
  description: "A square.",
  exits: { north: "room-inn" },
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};
const CELLAR: CachedRoom = {
  id: "room-cellar",
  enumKey: "TOWNSMEE_CELLAR",
  name: "Cellar",
  description: "Cold.",
  exits: {},
  environment: "townsmee",
  area: "townsmee",
  imageName: null,
};

function world(): WorldState {
  const w = new WorldState("pve");
  w.hydrate([SQUARE, CELLAR]);
  return w;
}

function registryWith(
  entries: Array<{ userId: string; name: string; roomId: string }>,
): { sessions: SessionRegistry; byUser: Map<string, SessionState> } {
  const sessions = new SessionRegistry();
  const byUser = new Map<string, SessionState>();
  for (const e of entries) {
    const s = sessions.open({}, e.userId, e.roomId);
    s.characterName = e.name;
    byUser.set(e.userId, s);
  }
  return { sessions, byUser };
}

const run = async (
  session: SessionState,
  sessions: SessionRegistry,
  input: string,
  isOperator: boolean,
) =>
  (
    await dispatch({
      world: world(),
      session,
      sessions,
      command: parseCommand(input),
      isOperator,
    })
  ).response;

describe("system, typed by an operator", () => {
  it("reaches every connected player, in whatever room they are in", async () => {
    // The whole point of the verb, and what distinguishes it from `yell`:
    // rooms are irrelevant. A player alone in the cellar must hear a restart
    // warning exactly as clearly as one standing in the square.
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
      { userId: "u-c", name: "Cael", roomId: CELLAR.id },
    ]);
    const res = await run(
      byUser.get("op")!,
      sessions,
      "system server restarting in 5 minutes",
      true,
    );

    expect(res.broadcasts).toEqual([
      {
        scope: "user",
        userId: "u-b",
        message: "[SYSTEM] server restarting in 5 minutes",
      },
      {
        scope: "user",
        userId: "u-c",
        message: "[SYSTEM] server restarting in 5 minutes",
      },
    ]);
  });

  it("tells the operator the count, not their own words back", async () => {
    // An operator needs to know it landed. Echoing the message tells them
    // nothing about whether anyone was there to read it.
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
      { userId: "u-c", name: "Cael", roomId: CELLAR.id },
    ]);
    const res = await run(byUser.get("op")!, sessions, "system hello", true);
    expect(res.lines.join(" ")).toContain("Announced to 2 players");
  });

  it("says so when nobody else is connected", async () => {
    // "Announced to 0 players" beats a cheerful confirmation that reached
    // nobody — an operator about to take the server down should know the
    // warning went nowhere.
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
    ]);
    const res = await run(byUser.get("op")!, sessions, "system hello", true);
    expect(res.broadcasts).toEqual([]);
    expect(res.lines.join(" ")).toContain("Announced to 0 players");
  });

  it("keeps the message whole, punctuation and all", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await run(
      byUser.get("op")!,
      sessions,
      "system Down at 21:00 UTC — save your progress!",
      true,
    );
    expect(res.broadcasts?.[0]?.message).toBe(
      "[SYSTEM] Down at 21:00 UTC — save your progress!",
    );
  });

  it("asks for a message rather than announcing an empty line", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await run(byUser.get("op")!, sessions, "system   ", true);
    expect(res.broadcasts).toBeUndefined();
    expect(res.lines.join(" ")).toContain("Announce what?");
  });
});

describe("system, typed by anyone else", () => {
  it("answers exactly as it would for a verb that does not exist", async () => {
    // NOT "you are not allowed". Knowing an operator verb exists is itself
    // information — it tells a griefer what to go looking for a way to run.
    const { sessions, byUser } = registryWith([
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const refused = await run(
      byUser.get("u-b")!,
      sessions,
      "system everybody log off",
      false,
    );
    const nonsense = await run(
      byUser.get("u-b")!,
      sessions,
      "flurble everybody log off",
      false,
    );

    expect(refused.lines.join(" ")).toContain('Unknown command "system"');
    // Same shape as an unknown verb, so the two are indistinguishable but
    // for the verb echoed back.
    expect(refused.lines.join(" ").replace("system", "flurble")).toBe(
      nonsense.lines.join(" "),
    );
    expect(refused.broadcasts).toBeUndefined();
  });

  it("reaches nobody, so a refused attempt cannot be used to spam", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
      { userId: "u-c", name: "Cael", roomId: CELLAR.id },
    ]);
    const res = await run(byUser.get("u-b")!, sessions, "system spam", false);
    expect(res.broadcasts ?? []).toEqual([]);
  });

  it("is absent from the handler table entirely, not merely refused inside it", async () => {
    // The stronger guarantee: there is no code path from a non-operator's
    // input into the handler, so a future bug inside it cannot become a
    // privilege escalation.
    expect(Object.keys(handlersFor({ combat: true }))).not.toContain("system");
    expect(Object.keys(handlersFor({ combat: true }, true))).toContain("system");
  });

  it("defaults to refused when the caller forgets to say", async () => {
    // Threading `isOperator` is the caller's job, and a caller that forgets
    // must grant nothing. An authorisation flag whose omission is permissive
    // is worse than no flag at all.
    const { sessions, byUser } = registryWith([
      { userId: "u-b", name: "Bran", roomId: SQUARE.id },
    ]);
    const res = await dispatch({
      world: world(),
      session: byUser.get("u-b")!,
      sessions,
      command: parseCommand("system anything"),
    });
    expect(res.response.lines.join(" ")).toContain('Unknown command "system"');
  });
});

describe("help", () => {
  it("names system only for an operator", async () => {
    const { sessions, byUser } = registryWith([
      { userId: "op", name: "Ops", roomId: SQUARE.id },
    ]);
    const asOperator = await run(byUser.get("op")!, sessions, "help", true);
    const asPlayer = await run(byUser.get("op")!, sessions, "help", false);

    expect(asOperator.lines.join("\n")).toContain("system <message>");
    // The dispatcher already refuses it; a help line naming the command
    // would undo that on the most-read screen in the game.
    expect(asPlayer.lines.join("\n")).not.toContain("system");
  });
});
