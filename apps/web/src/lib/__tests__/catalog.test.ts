import {
  BASE_DAMAGE,
  BASE_HP,
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
  it("sums the base with both modifiers", () => {
    const dwarf = findRace("dwarf")!;
    const warrior = findClass("warrior")!;
    expect(deriveStats(dwarf, warrior)).toEqual({
      hp: BASE_HP + 4 + 6,
      damage: BASE_DAMAGE + 0 + 3,
    });
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
