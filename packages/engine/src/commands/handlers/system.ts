/**
 * `system <message>` — an announcement to every connected player.
 *
 * Ported from `core/commands/system.py` in the Python original, which sent
 * to everyone and gated on nothing. The gate is the reason this arrives now
 * rather than with the other sixteen verbs (NEH-656).
 *
 * The handler itself does NOT check authority. It cannot be reached by a
 * non-operator, because the dispatcher only puts it in the table for one —
 * so an unauthorised player gets the ordinary unknown-verb reply, and never
 * learns the verb exists. A refusal message here would leak that.
 */

import type { CommandContext, CommandResponse } from "../types.js";
import { reply, replyWith } from "../types.js";

export function systemHandler(ctx: CommandContext): CommandResponse {
  const message = ctx.command.rest?.trim() ?? "";
  if (!message) {
    return reply("Announce what? Usage: system <message>");
  }

  const sessions = ctx.sessions;
  if (!sessions) {
    // No registry means nothing to announce to. Saying so plainly beats a
    // cheerful "announced" that reached nobody.
    return reply("There is nobody connected to announce to.");
  }

  // Every live session except the announcer, who is told the count instead —
  // an operator needs to know it landed, and hearing their own words back is
  // not that.
  const recipients = sessions
    .all()
    .filter((s) => s.userId !== ctx.session.userId);

  const line = `[SYSTEM] ${message}`;
  const broadcasts = recipients.map((s) => ({
    scope: "user" as const,
    userId: s.userId,
    message: line,
  }));

  return replyWith(
    broadcasts,
    `Announced to ${recipients.length} ${
      recipients.length === 1 ? "player" : "players"
    }: ${message}`,
  );
}
