/**
 * Race and class catalog for character creation.
 *
 * THE ENGINE IS THE SOURCE OF TRUTH. Both the list and the arithmetic come
 * from `@nehsamud/engine`: the same fixtures the seed writes into
 * `mud.race` / `mud.class`, and the same `deriveCharacter` the server runs
 * when it creates the row.
 *
 * Imported from the `/character` and `/catalog` SUBPATHS, never the package
 * root. The root pulls in the whole server — express, Prisma, OpenTelemetry —
 * and this file is reached from a client component, so a root import breaks
 * the browser build outright. Those two entry points are pure arithmetic and
 * pure data, with no runtime dependencies at all.
 *
 * This file used to keep its own six races, its own six classes and its own
 * hp/damage modifier table — numbers unrelated to the engine's seven
 * attribute modifiers. The creation screen previewed "40 HP" for a Dwarf
 * Warrior while the server built something else entirely, and nothing
 * anywhere compared the two. A preview that disagrees with the engine is
 * worse than no preview, because the player has been shown a promise.
 */

import { deriveCharacter } from "@nehsamud/engine/character";
import {
  CLASSES as ENGINE_CLASSES,
  RACES as ENGINE_RACES,
} from "@nehsamud/engine/catalog";

/** The seven attribute modifiers a race or class contributes. */
export interface StatModifiers {
  readonly strengthMod: number;
  readonly intelligenceMod: number;
  readonly wisdomMod: number;
  readonly charismaMod: number;
  readonly constitutionMod: number;
  readonly dexterityMod: number;
  readonly luckMod: number;
}

export interface Race {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly modifiers: StatModifiers;
}

export interface CharacterClass {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly modifiers: StatModifiers;
}

/** Engine fixture → the shape this UI renders. Slug becomes `key`. */
function toOption<T extends { slug: string; name: string; description: string }>(
  fixture: T & StatModifiers,
): { key: string; name: string; description: string; modifiers: StatModifiers } {
  return {
    key: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    modifiers: {
      strengthMod: fixture.strengthMod,
      intelligenceMod: fixture.intelligenceMod,
      wisdomMod: fixture.wisdomMod,
      charismaMod: fixture.charismaMod,
      constitutionMod: fixture.constitutionMod,
      dexterityMod: fixture.dexterityMod,
      luckMod: fixture.luckMod,
    },
  };
}

export const RACES: readonly Race[] = ENGINE_RACES.map(toOption);
export const CLASSES: readonly CharacterClass[] = ENGINE_CLASSES.map(toOption);

export function findRace(key: string): Race | undefined {
  return RACES.find((race) => race.key === key);
}

export function findClass(key: string): CharacterClass | undefined {
  return CLASSES.find((characterClass) => characterClass.key === key);
}

export interface DerivedStats {
  readonly hp: number;
  readonly damage: number;
}

/**
 * The stat preview shown at creation.
 *
 * Delegates to the engine's `deriveCharacter`, so what the player is shown
 * here is by construction what the server will write. Any floor or cap lives
 * there, in one place, rather than being re-decided by whoever is drawing a
 * form.
 */
export function deriveStats(
  race: Race,
  characterClass: CharacterClass,
): DerivedStats {
  const derived = deriveCharacter(race.modifiers, characterClass.modifiers);
  return { hp: derived.maxHp, damage: derived.baseDamage };
}

export const NAME_MIN = 3;
export const NAME_MAX = 20;

export function validateCharacterName(raw: string): string | undefined {
  const name = raw.trim();
  if (name.length < NAME_MIN) {
    return `Name must be at least ${NAME_MIN} characters.`;
  }
  if (name.length > NAME_MAX) {
    return `Name must be ${NAME_MAX} characters or fewer.`;
  }
  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(name)) {
    return "Use letters only, with no more than one hyphen or apostrophe between parts.";
  }
  return undefined;
}
