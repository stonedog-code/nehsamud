import { deriveCharacter, maxHpForLevel } from "@nehsamud/engine/character";
import {
  NAME_MAX,
  OPTION_GROUPS,
  deriveStats,
  findGroup,
  findOption,
  resolveSelection,
  validateCharacterName,
} from "../catalog";
import type { SelectedOption } from "../catalog";

/** Answer every declared axis with the named options, in declared order. */
function select(...optionKeys: string[]): readonly SelectedOption[] {
  const answers = Object.fromEntries(
    OPTION_GROUPS.map((group, i) => [group.key, optionKeys[i]]),
  );
  const selection = resolveSelection(answers);
  if (!selection) throw new Error(`no selection for ${optionKeys.join(", ")}`);
  return selection;
}

/** Every combination of one option per group. */
function everyCombination(): Array<readonly SelectedOption[]> {
  return OPTION_GROUPS.reduce<Array<readonly SelectedOption[]>>(
    (acc, group) =>
      acc.flatMap((partial) =>
        group.options.map((option) => [...partial, { group, option }]),
      ),
    [[]],
  );
}

describe("catalog", () => {
  it("declares the pack's axes, with six choices on each", () => {
    // Deliberately asserts the KEYS, not just the count: this file used to
    // hardcode a race list and a class list, and the point of the change is
    // that both now come from whatever the pack declares.
    expect(OPTION_GROUPS.map((g) => g.key)).toEqual(["race", "class"]);
    for (const group of OPTION_GROUPS) {
      expect(group.options).toHaveLength(6);
    }
  });

  it("uses keys unique within each group", () => {
    for (const group of OPTION_GROUPS) {
      const keys = group.options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("finds by key and returns undefined otherwise", () => {
    expect(findOption("race", "dwarf")?.name).toBe("Dwarf");
    expect(findOption("class", "mage")?.name).toBe("Mage");
    expect(findOption("race", "dragon")).toBeUndefined();
    expect(findGroup("alignment")).toBeUndefined();
  });

  it("will not resolve an option against the wrong group", () => {
    // Slugs are unique only within a group, so a lookup that ignored the
    // group could answer a question with something from a different axis.
    expect(findOption("class", "dwarf")).toBeUndefined();
    expect(
      resolveSelection({ race: "warrior", class: "warrior" }),
    ).toBeUndefined();
  });

  it("refuses a selection that leaves an axis unanswered", () => {
    expect(resolveSelection({ race: "dwarf" })).toBeUndefined();
    expect(resolveSelection({})).toBeUndefined();
  });
});

describe("deriveStats", () => {
  it("returns exactly what the engine will build", () => {
    // The assertion that matters: this is not an independent formula that
    // happens to agree, it IS the engine's. The previous version of this
    // test asserted against a local BASE_HP + a local modifier table, and
    // passed happily while the server produced different numbers.
    for (const selection of everyCombination()) {
      const engine = deriveCharacter(selection.map((s) => s.option.modifiers));
      expect(deriveStats(selection)).toEqual({
        hp: engine.maxHp,
        damage: engine.baseDamage,
      });
    }
  });

  it("previews the level-1 pool, not some other level", () => {
    const selection = select("dwarf", "warrior");
    const { attributes } = deriveCharacter(
      selection.map((s) => s.option.modifiers),
    );
    expect(deriveStats(selection).hp).toBe(
      maxHpForLevel(1, attributes.constitution),
    );
  });

  it("makes a tough combination tougher than a frail one", () => {
    // Direction, not just difference: a Dwarf Warrior must out-live a
    // Halfling Mage, or the modifier tables are being read but not applied
    // in the way the descriptions promise.
    const tough = deriveStats(select("dwarf", "warrior"));
    const frail = deriveStats(select("halfling", "mage"));
    expect(tough.hp).toBeGreaterThan(frail.hp);
    expect(tough.damage).toBeGreaterThan(frail.damage);
  });

  it("makes different combinations genuinely different", () => {
    // PRD-0001 R9 — the choice has to matter. A catalog edit that flattened
    // every option into the same numbers would pass every other test.
    const combinations = everyCombination().map((selection) => {
      const { hp, damage } = deriveStats(selection);
      return `${hp}/${damage}`;
    });
    expect(new Set(combinations).size).toBeGreaterThan(1);
  });

  it("never previews a character with less than 1 HP or damage", () => {
    for (const selection of everyCombination()) {
      const stats = deriveStats(selection);
      expect(stats.hp).toBeGreaterThanOrEqual(1);
      expect(stats.damage).toBeGreaterThanOrEqual(1);
    }
  });

  it("builds a plain character when the pack declares no axes", () => {
    // The care-centre case: you are simply a resident. It must produce a
    // real character rather than throwing or returning zero.
    const stats = deriveStats([]);
    expect(stats.hp).toBeGreaterThanOrEqual(1);
    expect(stats.damage).toBeGreaterThanOrEqual(1);
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
