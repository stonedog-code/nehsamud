/**
 * Race and class catalog for character creation.
 *
 * Static for the scaffold. The live app reads these from `mud.race` /
 * `mud.class` once the engine extraction lands — the shapes here mirror those
 * rows so the swap is a data-source change rather than a UI change.
 *
 * The modifiers are shown to the player at creation because PRD-0001 R9
 * requires the choice to measurably change play. Displaying numbers that the
 * engine does not yet apply would be a lie, so the UI labels them as the
 * intended effect until the engine honours them.
 */

export interface StatModifiers {
  /** Added to base starting HP. */
  readonly hp: number;
  /** Added to base melee damage. */
  readonly damage: number;
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

export const RACES: readonly Race[] = [
  {
    key: "human",
    name: "Human",
    description: "Adaptable and even-tempered. No weaknesses worth naming.",
    modifiers: { hp: 0, damage: 0 },
  },
  {
    key: "elf",
    name: "Elf",
    description: "Quick and perceptive, but slight of frame.",
    modifiers: { hp: -2, damage: 1 },
  },
  {
    key: "dwarf",
    name: "Dwarf",
    description: "Stubborn and hard to put down.",
    modifiers: { hp: 4, damage: 0 },
  },
  {
    key: "halfling",
    name: "Halfling",
    description: "Small, lucky, and much harder to hit than they look.",
    modifiers: { hp: -3, damage: 0 },
  },
  {
    key: "orc",
    name: "Orc",
    description: "Enormously strong and entirely unsubtle.",
    modifiers: { hp: 3, damage: 2 },
  },
  {
    key: "half-orc",
    name: "Half-Orc",
    description: "The strength, tempered by the patience to use it.",
    modifiers: { hp: 2, damage: 1 },
  },
];

export const CLASSES: readonly CharacterClass[] = [
  {
    key: "warrior",
    name: "Warrior",
    description: "Front line. Hits hard, takes hits, asks no questions.",
    modifiers: { hp: 6, damage: 3 },
  },
  {
    key: "mage",
    name: "Mage",
    description: "Devastating at range, fragile up close.",
    modifiers: { hp: -4, damage: 4 },
  },
  {
    key: "rogue",
    name: "Rogue",
    description: "Strikes from the dark and is gone before the reply.",
    modifiers: { hp: 0, damage: 2 },
  },
  {
    key: "cleric",
    name: "Cleric",
    description: "Endures, and keeps others standing.",
    modifiers: { hp: 4, damage: 1 },
  },
  {
    key: "ranger",
    name: "Ranger",
    description: "At home in the wild, and a reliable shot.",
    modifiers: { hp: 2, damage: 2 },
  },
  {
    key: "bard",
    name: "Bard",
    description: "Talks their way past most of it, fights the rest.",
    modifiers: { hp: 1, damage: 1 },
  },
];

/** Base pool before race and class modifiers. Mirrors the engine's current
 * `DEFAULT_MAX_HP`, so the preview matches what the server will build. */
export const BASE_HP = 30;
export const BASE_DAMAGE = 5;

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
 * Floored at 1 so an unlucky combination cannot preview a character that is
 * dead on arrival — with the current tables the worst case is a Halfling Mage
 * at 23 HP, but the tables are expected to grow and the floor should not
 * depend on anyone re-checking the arithmetic.
 */
export function deriveStats(
  race: Race,
  characterClass: CharacterClass,
): DerivedStats {
  return {
    hp: Math.max(1, BASE_HP + race.modifiers.hp + characterClass.modifiers.hp),
    damage: Math.max(
      1,
      BASE_DAMAGE + race.modifiers.damage + characterClass.modifiers.damage,
    ),
  };
}

/**
 * Character names are the player's identity in the world, so the rules are
 * deliberately narrow: letters, and single interior hyphens or apostrophes.
 * Rejecting rather than sanitising means the player always sees the name they
 * chose, never a silently altered one.
 */
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
