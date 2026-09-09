/**
 * Which world this process serves.
 *
 * PRD-0002 R2: the engine takes exactly one pack at boot, from
 * configuration. NG2 is the other half of that — a world instance serves one
 * pack for its whole life, exactly as it serves one mode. There is no
 * runtime switching, so this is resolved once during boot and threaded, not
 * looked up per request.
 *
 * Modelled on `resolveGameMode` deliberately, including the decision to
 * throw on an unrecognised value: a typo that quietly fell back to the
 * bundled world would put a fantasy town in front of a care-centre
 * deployment and nothing would report it. Failing the boot puts the mistake
 * in front of the operator while they are still deploying.
 */

import { assertValidContentPack, type ContentPack } from "./pack.js";
import { TOWNSMEE_PACK } from "./townsmee.js";

/** Environment variable naming the pack. */
export const CONTENT_PACK_ENV = "MUD_CONTENT_PACK";

/**
 * The packs shipped in this repository, by key.
 *
 * One entry today. The registry exists anyway because it is what makes the
 * env var meaningful and the error message honest — an operator who
 * mistypes gets the list of what is actually available rather than a silent
 * fallback. A host that authors its own pack does not register it here: it
 * constructs a {@link ContentPack} and passes it to the seeder and the
 * server directly, which is the whole point of the contract.
 */
export const BUNDLED_PACKS: Readonly<Record<string, ContentPack>> = {
  [TOWNSMEE_PACK.key]: TOWNSMEE_PACK,
};

/**
 * The pack a process serves when `MUD_CONTENT_PACK` is not set.
 *
 * Townsmee, because the standalone deployment is the one that exists and
 * has players' expectations attached to it. Unlike the game mode — where
 * the safe default is the restrictive one — there is no "safe" world to
 * fall back to, so the default is simply the historical behaviour.
 */
export const DEFAULT_CONTENT_PACK_KEY = TOWNSMEE_PACK.key;

/**
 * Resolve and validate the pack this process will serve.
 *
 * Validation happens HERE rather than at each call site, so there is no way
 * to obtain a pack through the supported path without it having been
 * checked (R5). A host passing its own pack object calls
 * {@link assertValidContentPack} itself — which is why that function is
 * exported rather than kept private to this module.
 */
export function resolveContentPack(
  env: Record<string, string | undefined> = process.env,
): ContentPack {
  const raw = env[CONTENT_PACK_ENV]?.trim();
  const key = raw ? raw.toLowerCase() : DEFAULT_CONTENT_PACK_KEY;

  const pack = BUNDLED_PACKS[key];
  if (!pack) {
    throw new Error(
      `${CONTENT_PACK_ENV}="${raw}" names no bundled content pack. ` +
        `Expected one of: ${Object.keys(BUNDLED_PACKS).join(", ")}.`,
    );
  }

  assertValidContentPack(pack);
  return pack;
}
