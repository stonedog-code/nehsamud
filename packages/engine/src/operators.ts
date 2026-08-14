/**
 * Who is allowed to act on the world rather than in it.
 *
 * `system` is the first verb that needs this concept, but it will not be the
 * last — kick, mute, teleport and shutdown all want the same answer to the
 * same question, so it is worth deciding once here rather than growing from
 * a check invented inside one handler (NEH-656).
 *
 * ## Why an env-listed set of owner ids
 *
 * Three shapes were defensible; this one was picked:
 *
 * - **A flag on `mud.player`** is wrong because operator authority belongs
 *   to a *person*, not a *character*. A player who rebirths, or keeps two
 *   characters, would have to be granted it twice, and a griefer who made a
 *   character called `Admin` would look like one in every listing.
 * - **A JWT claim** would make the engine's authorisation model a downstream
 *   consequence of whatever the host app decided to mint. HopperGuard is one
 *   host; the standalone app and third-party clients are others. An engine
 *   that can only be administered by the app that wrapped it is not a
 *   reusable engine.
 * - **An env-listed set of owner ids** — this. It is self-contained, it
 *   matches the deployment (an operator of *this* world, not of every world
 *   the engine runs), it survives a database restore, and it is revoked by a
 *   redeploy rather than by a migration.
 *
 * The cost is honest: granting operator authority requires a deploy. That is
 * a feature at this scale — it means the grant is reviewable, and there is
 * no in-game path by which authority can be acquired.
 *
 * ## Owner id, not character name
 *
 * The set holds the same ids the JWT `sub` carries and `mud.player.ownerId`
 * stores, so it is stable across renames and rebirths.
 */

/** Env var holding a comma-separated list of owner ids. */
export const OPERATORS_ENV = "MUD_OPERATOR_IDS";

/**
 * Parse the operator set from an environment.
 *
 * Unset, empty, or all-whitespace yields an empty set — a world with no
 * operators, which is the correct default. Nothing here ever falls back to
 * "everyone": an authorisation model whose failure mode is permissive is not
 * an authorisation model.
 */
export function resolveOperators(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env[OPERATORS_ENV];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/**
 * Is this owner an operator of this world?
 *
 * Case-sensitive, because the ids are opaque identifiers rather than names —
 * a case-insensitive comparison would silently widen the set, and widening
 * is the direction that costs something.
 */
export function isOperator(
  userId: string | undefined,
  operators: ReadonlySet<string>,
): boolean {
  return userId !== undefined && operators.has(userId);
}
