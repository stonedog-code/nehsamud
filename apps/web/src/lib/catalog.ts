/**
 * The character-creation axes this build offers, and the arithmetic behind
 * the stat preview.
 *
 * THE ENGINE IS THE SOURCE OF TRUTH. Both the axes and the arithmetic come
 * from `@nehsamud/engine`: the same fixtures the seed writes into
 * `mud.character_option_group` / `mud.character_option`, and the same
 * `deriveCharacter` the server runs when it creates the row.
 *
 * NOTHING HERE NAMES AN AXIS. This file used to export `RACES` and
 * `CLASSES`, because the schema had a `race` table and a `class` table and
 * every world was assumed to have exactly those two. A pack now declares its
 * own — so the UI renders whatever groups it is given, in the order it is
 * given them, and a pack that adds a third axis needs no change here.
 *
 * Imported from the `/character` and `/catalog` SUBPATHS, never the package
 * root. The root pulls in the whole server — express, Prisma, OpenTelemetry —
 * and this file is reached from a client component, so a root import breaks
 * the browser build outright. Those two entry points are pure arithmetic and
 * pure data, with no runtime dependencies at all.
 *
 * This file also used to keep its own six races, its own six classes and its
 * own hp/damage modifier table — numbers unrelated to the engine's seven
 * attribute modifiers. The creation screen previewed "40 HP" for a Dwarf
 * Warrior while the server built something else entirely, and nothing
 * anywhere compared the two. A preview that disagrees with the engine is
 * worse than no preview, because the player has been shown a promise.
 */

import { deriveCharacter } from "@nehsamud/engine/character";
import { CHARACTER_OPTION_GROUPS } from "@nehsamud/engine/catalog";

/** The seven attribute modifiers one chosen option contributes. */
export interface StatModifiers {
  readonly strengthMod: number;
  readonly intelligenceMod: number;
  readonly wisdomMod: number;
  readonly charismaMod: number;
  readonly constitutionMod: number;
  readonly dexterityMod: number;
  readonly luckMod: number;
}

/** One choice on one axis. */
export interface OptionChoice {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly modifiers: StatModifiers;
}

/** One axis of character creation, as the form renders it. */
export interface OptionGroup {
  /** Stable key — the query parameter and the wire value, e.g. "race". */
  readonly key: string;
  /** What the player is shown, e.g. "Race". */
  readonly name: string;
  readonly description: string;
  readonly options: readonly OptionChoice[];
}

export const OPTION_GROUPS: readonly OptionGroup[] = [
  ...CHARACTER_OPTION_GROUPS,
]
  // Ordered here rather than trusted from the fixture: the server orders by
  // (position, key) when it asks the same questions, and a form that asks
  // them in a different order than the transcript does is a small, constant
  // confusion.
  .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
  .map((group) => ({
    key: group.key,
    name: group.name,
    description: group.description,
    options: group.options
      .filter((option) => option.selectable !== false)
      .map((option) => ({
        key: option.slug,
        name: option.name,
        description: option.description,
        modifiers: {
          strengthMod: option.strengthMod,
          intelligenceMod: option.intelligenceMod,
          wisdomMod: option.wisdomMod,
          charismaMod: option.charismaMod,
          constitutionMod: option.constitutionMod,
          dexterityMod: option.dexterityMod,
          luckMod: option.luckMod,
        },
      })),
  }));

export function findGroup(key: string): OptionGroup | undefined {
  return OPTION_GROUPS.find((group) => group.key === key);
}

export function findOption(
  groupKey: string,
  optionKey: string,
): OptionChoice | undefined {
  return findGroup(groupKey)?.options.find(
    (option) => option.key === optionKey,
  );
}

/**
 * Resolve one option per group from a set of `groupKey → optionKey` answers.
 *
 * Returns undefined when any group is unanswered or answered with something
 * that is not on offer. All-or-nothing on purpose: substituting a default
 * for the bad half is exactly the bug this replaced — a silent fallback and
 * a working selection look identical from the outside.
 */
export function resolveSelection(
  answers: Record<string, string | undefined>,
): readonly SelectedOption[] | undefined {
  const selected: SelectedOption[] = [];
  for (const group of OPTION_GROUPS) {
    const answer = answers[group.key];
    if (typeof answer !== "string") return undefined;
    const option = findOption(group.key, answer);
    if (!option) return undefined;
    selected.push({ group, option });
  }
  return selected;
}

/** A resolved answer: which axis, and what was picked on it. */
export interface SelectedOption {
  readonly group: OptionGroup;
  readonly option: OptionChoice;
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
  selection: readonly SelectedOption[],
): DerivedStats {
  const derived = deriveCharacter(selection.map((s) => s.option.modifiers));
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
