import {
  BASE_ATTRIBUTE,
  BASE_MAX_HP,
  BASE_PLAYER_DAMAGE,
  MIN_ATTRIBUTE,
  baseDamageFor,
  deriveAttributes,
  deriveCharacter,
  maxHpForLevel,
  type AttributeMods,
} from "../character.js";
import { gainsForLevel } from "../progression.js";
import { CHARACTER_OPTION_GROUPS } from "../seed/fixtures/index.js";

/**
 * Character-creation choices becoming real numbers.
 *
 * The option tables carried seven modifier columns each, seeded
 * with real values, that nothing read — and `createPlayer` wrote no
 * attributes at all, so every character had 10 across the board. A Dwarf
 * Warrior and a Halfling Mage were the same character.
 *
 * The tests that matter most are the DIRECTION ones. Asserting that two
 * combinations differ passes just as well when the numbers are wired
 * backwards; asserting that the tough one is tougher does not.
 */

const option = (groupKey: string, slug: string) => {
  const group = CHARACTER_OPTION_GROUPS.find((g) => g.key === groupKey);
  const found = group?.options.find((o) => o.slug === slug);
  if (!found) throw new Error(`no ${groupKey} option "${slug}"`);
  return found;
};
const race = (slug: string) => option("race", slug);
const klass = (slug: string) => option("class", slug);
/** The fixture's two axes, answered — what a real creation produces. */
const both = (raceSlug: string, classSlug: string) => [
  race(raceSlug),
  klass(classSlug),
];

/** Every combination of one option per declared group. */
const everyCombination = () =>
  CHARACTER_OPTION_GROUPS.reduce<AttributeMods[][]>(
    (acc, group) =>
      acc.flatMap((partial) =>
        group.options.map((option) => [...partial, option]),
      ),
    [[]],
  );

/* ── attributes ───────────────────────────────────────────────── */

describe("deriveAttributes", () => {
  it("adds race and class to the base", () => {
    // Dwarf str +2, Warrior str +2.
    const attrs = deriveAttributes(both("dwarf", "warrior"));
    expect(attrs.strength).toBe(BASE_ATTRIBUTE + 4);
    expect(attrs.constitution).toBe(BASE_ATTRIBUTE + 4);
  });

  it("applies penalties as well as bonuses", () => {
    // Halfling str -1, Mage str -1.
    expect(deriveAttributes(both("halfling", "mage")).strength).toBe(
      BASE_ATTRIBUTE - 2,
    );
  });

  it("floors every attribute rather than allowing zero or negative", () => {
    const brutal = {
      strengthMod: -99,
      intelligenceMod: -99,
      wisdomMod: -99,
      charismaMod: -99,
      constitutionMod: -99,
      dexterityMod: -99,
      luckMod: -99,
    };
    const attrs = deriveAttributes([brutal, brutal]);
    for (const value of Object.values(attrs)) {
      expect(value).toBe(MIN_ATTRIBUTE);
    }
  });

  it("gives every seeded combination a full set of positive attributes", () => {
    for (const combination of everyCombination()) {
      const attrs = deriveAttributes(combination);
      expect(Object.keys(attrs)).toHaveLength(7);
      for (const value of Object.values(attrs)) {
        expect(value).toBeGreaterThanOrEqual(MIN_ATTRIBUTE);
      }
    }
  });

  it("builds a character from no choices at all", () => {
    // A pack may declare no axes — the care-centre world, where you are
    // simply a resident. That has to produce base attributes rather than an
    // empty object or a throw, because the create path calls this with
    // exactly what the pack declared.
    expect(deriveAttributes([])).toEqual({
      strength: BASE_ATTRIBUTE,
      intelligence: BASE_ATTRIBUTE,
      wisdom: BASE_ATTRIBUTE,
      charisma: BASE_ATTRIBUTE,
      constitution: BASE_ATTRIBUTE,
      dexterity: BASE_ATTRIBUTE,
      luck: BASE_ATTRIBUTE,
    });
  });

  it("does not care what order the axes come in", () => {
    // Addition, so a pack reordering its groups must not change anybody's
    // character.
    expect(deriveAttributes(both("dwarf", "warrior"))).toEqual(
      deriveAttributes([klass("warrior"), race("dwarf")]),
    );
  });
});

/* ── health ───────────────────────────────────────────────────── */

describe("maxHpForLevel", () => {
  it("gives an average character the base pool at level 1", () => {
    expect(maxHpForLevel(1, BASE_ATTRIBUTE)).toBe(BASE_MAX_HP);
  });

  it("rewards constitution and punishes its absence", () => {
    expect(maxHpForLevel(1, BASE_ATTRIBUTE + 4)).toBeGreaterThan(BASE_MAX_HP);
    expect(maxHpForLevel(1, BASE_ATTRIBUTE - 2)).toBeLessThan(BASE_MAX_HP);
  });

  it("grows with level", () => {
    expect(maxHpForLevel(10, BASE_ATTRIBUTE)).toBeGreaterThan(
      maxHpForLevel(1, BASE_ATTRIBUTE),
    );
  });

  it("widens the constitution gap as levels pass", () => {
    // A fixed bonus would be decisive at level 1 and noise at level 100.
    const gapAtOne =
      maxHpForLevel(1, BASE_ATTRIBUTE + 4) - maxHpForLevel(1, BASE_ATTRIBUTE);
    const gapAtFifty =
      maxHpForLevel(50, BASE_ATTRIBUTE + 4) - maxHpForLevel(50, BASE_ATTRIBUTE);
    expect(gapAtFifty).toBeGreaterThan(gapAtOne);
  });

  it("never returns less than 1, however frail", () => {
    expect(maxHpForLevel(1, MIN_ATTRIBUTE)).toBeGreaterThanOrEqual(1);
  });
});

describe("level-up gains agree with the level-1 pool", () => {
  it("levelling to N gives the same maximum as being created at N", () => {
    // The reason gainsForLevel is a DIFFERENCE of maxHpForLevel rather than
    // its own formula: two formulas drift the moment either is touched, and
    // the symptom is a character whose HP depends on how they got there.
    for (const constitution of [6, 10, 14, 18]) {
      let accumulated = maxHpForLevel(1, constitution);
      for (let level = 2; level <= 20; level += 1) {
        accumulated += gainsForLevel(level, constitution).maxHp;
        expect(accumulated).toBe(maxHpForLevel(level, constitution));
      }
    }
  });

  it("grants a tougher character more per level", () => {
    expect(gainsForLevel(5, BASE_ATTRIBUTE + 6).maxHp).toBeGreaterThan(
      gainsForLevel(5, BASE_ATTRIBUTE).maxHp,
    );
  });
});

/* ── damage ───────────────────────────────────────────────────── */

describe("baseDamageFor", () => {
  it("gives an average character the base damage", () => {
    expect(baseDamageFor(BASE_ATTRIBUTE)).toBe(BASE_PLAYER_DAMAGE);
  });

  it("rewards strength and punishes its absence", () => {
    expect(baseDamageFor(BASE_ATTRIBUTE + 6)).toBeGreaterThan(
      BASE_PLAYER_DAMAGE,
    );
    expect(baseDamageFor(BASE_ATTRIBUTE - 4)).toBeLessThan(BASE_PLAYER_DAMAGE);
  });

  it("always threatens at least 1", () => {
    expect(baseDamageFor(MIN_ATTRIBUTE)).toBeGreaterThanOrEqual(1);
    expect(baseDamageFor(-50)).toBeGreaterThanOrEqual(1);
  });

  it("keeps the class spread smaller than a weapon upgrade", () => {
    // A Maul is +14. If being an Orc Warrior instead of a Halfling Mage beat
    // that, equipment would stop mattering and `equip` would be decoration.
    const strongest = deriveCharacter(both("orc", "warrior"));
    const weakest = deriveCharacter(both("halfling", "mage"));
    expect(strongest.baseDamage - weakest.baseDamage).toBeLessThan(14);
  });
});

/* ── the whole character ──────────────────────────────────────── */

describe("deriveCharacter", () => {
  it("makes a Dwarf Warrior tougher and stronger than a Halfling Mage", () => {
    // The failure scenario named in NEH-621, asserted directionally.
    const dwarfWarrior = deriveCharacter(both("dwarf", "warrior"));
    const halflingMage = deriveCharacter(both("halfling", "mage"));

    expect(dwarfWarrior.maxHp).toBeGreaterThan(halflingMage.maxHp);
    expect(dwarfWarrior.baseDamage).toBeGreaterThan(halflingMage.baseDamage);
    expect(dwarfWarrior.attributes.constitution).toBeGreaterThan(
      halflingMage.attributes.constitution,
    );
  });

  it("makes the nimble ones nimble", () => {
    // Not everything is a hit-point race: a Halfling Rogue should lead on
    // dexterity even though it loses on health.
    const halflingRogue = deriveCharacter(both("halfling", "rogue"));
    const dwarfWarrior = deriveCharacter(both("dwarf", "warrior"));
    expect(halflingRogue.attributes.dexterity).toBeGreaterThan(
      dwarfWarrior.attributes.dexterity,
    );
  });

  it("produces more than one distinct character across the catalog", () => {
    // A table edit that flattened every modifier to zero would pass every
    // other test in this file.
    const shapes = new Set<string>();
    for (const combination of everyCombination()) {
      const d = deriveCharacter(combination);
      shapes.add(`${d.maxHp}/${d.baseDamage}`);
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("leaves no seeded combination unplayable", () => {
    for (const combination of everyCombination()) {
      const d = deriveCharacter(combination);
      expect(d.maxHp).toBeGreaterThan(0);
      expect(d.baseDamage).toBeGreaterThan(0);
    }
  });
});
