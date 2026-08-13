import { deriveCharacter, maxHpForLevel } from "@nehsamud/engine/character";
import {
  CLASSES,
  NAME_MAX,
  RACES,
  deriveStats,
  findClass,
  findRace,
  validateCharacterName,
} from "../catalog";

describe("catalog", () => {
  it("offers six races and six classes", () => {
    expect(RACES).toHaveLength(6);
    expect(CLASSES).toHaveLength(6);
  });

  it("uses unique keys", () => {
    expect(new Set(RACES.map((r) => r.key)).size).toBe(RACES.length);
    expect(new Set(CLASSES.map((c) => c.key)).size).toBe(CLASSES.length);
  });

  it("finds by key and returns undefined otherwise", () => {
    expect(findRace("dwarf")?.name).toBe("Dwarf");
    expect(findClass("mage")?.name).toBe("Mage");
    expect(findRace("dragon")).toBeUndefined();
    expect(findClass("necromancer")).toBeUndefined();
  });
});

describe("deriveStats", () => {
  it("returns exactly what the engine will build", () => {
    // The assertion that matters: this is not an independent formula that
    // happens to agree, it IS the engine's. The previous version of this
    // test asserted against a local BASE_HP + a local modifier table, and
    // passed happily while the server produced different numbers.
    for (const race of RACES) {
      for (const characterClass of CLASSES) {
        const engine = deriveCharacter(
          race.modifiers,
          characterClass.modifiers,
        );
        expect(deriveStats(race, characterClass)).toEqual({
          hp: engine.maxHp,
          damage: engine.baseDamage,
        });
      }
    }
  });

  it("previews the level-1 pool, not some other level", () => {
    const dwarf = findRace("dwarf")!;
    const warrior = findClass("warrior")!;
    const { attributes } = deriveCharacter(dwarf.modifiers, warrior.modifiers);
    expect(deriveStats(dwarf, warrior).hp).toBe(
      maxHpForLevel(1, attributes.constitution),
    );
  });

  it("makes a tough combination tougher than a frail one", () => {
    // Direction, not just difference: a Dwarf Warrior must out-live a
    // Halfling Mage, or the modifier tables are being read but not applied
    // in the way the descriptions promise.
    const tough = deriveStats(findRace("dwarf")!, findClass("warrior")!);
    const frail = deriveStats(findRace("halfling")!, findClass("mage")!);
    expect(tough.hp).toBeGreaterThan(frail.hp);
    expect(tough.damage).toBeGreaterThan(frail.damage);
  });

  it("makes different combinations genuinely different", () => {
    // PRD-0001 R9 — the choice has to matter. A catalog edit that flattened
    // every race and class into the same numbers would pass every other test.
    const combinations = RACES.flatMap((race) =>
      CLASSES.map((characterClass) => {
        const { hp, damage } = deriveStats(race, characterClass);
        return `${hp}/${damage}`;
      }),
    );
    expect(new Set(combinations).size).toBeGreaterThan(1);
  });

  it("never previews a character with less than 1 HP or damage", () => {
    for (const race of RACES) {
      for (const characterClass of CLASSES) {
        const stats = deriveStats(race, characterClass);
        expect(stats.hp).toBeGreaterThanOrEqual(1);
        expect(stats.damage).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("validateCharacterName", () => {
  it.each([["Aria"], ["Bran"], ["Mary-Anne"], ["O'Donnell"]])(
    "accepts %s",
    (name) => {
      expect(validateCharacterName(name)).toBeUndefined();
    },
  );

  it("trims before measuring", () => {
    expect(validateCharacterName("  Aria  ")).toBeUndefined();
  });

  it("rejects names that are too short or too long", () => {
    expect(validateCharacterName("Al")).toMatch(/at least/);
    expect(validateCharacterName("A".repeat(NAME_MAX + 1))).toMatch(/or fewer/);
  });

  it.each([
    ["Ari4"],
    ["Bran the Bold"],
    ["-Aria"],
    ["Aria-"],
    ["Mary--Anne"],
    ["<script>x</script>"],
  ])("rejects %p", (name) => {
    expect(validateCharacterName(name)).toBeDefined();
  });
});
