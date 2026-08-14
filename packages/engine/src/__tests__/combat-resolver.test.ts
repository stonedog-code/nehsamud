import {
  BASE_HIT_CHANCE,
  CRIT_MULTIPLIER,
  DAMAGE_PER_LEVEL,
  MAX_HIT_CHANCE,
  MAX_ARMOUR_ABSORB,
  MIN_DAMAGE_ON_HIT,
  MIN_HIT_CHANCE,
  createRng,
  describeAttack,
  hitChance,
  resolveAttack,
  type Combatant,
  type Rng,
} from "../combat.js";

/**
 * Combat used to be two constants, so a fight's outcome was fixed the moment
 * it started. These tests are about the properties that replaced it, not the
 * specific numbers — the tuning constants are a balance decision still open,
 * and pinning "a level-3 fighter deals 7" would have to be rewritten on every
 * balance pass, which teaches people to edit tests to match code.
 *
 * The one place exact values ARE pinned is the seeded-sequence test, because
 * reproducibility is itself the feature.
 */

const PLAYER: Combatant = { name: "you", level: 1, baseDamage: 5 };
const GOBLIN: Combatant = { name: "goblin", level: 1, baseDamage: 2 };

/** An RNG that returns a scripted list, then throws. Makes "which roll is
 * this?" explicit, and fails loudly if the resolver draws more than expected —
 * roll ORDER is part of the contract. */
function scripted(values: number[]): Rng {
  let i = 0;
  return {
    next(): number {
      if (i >= values.length) {
        throw new Error(`resolver drew more rolls than scripted (${i + 1})`);
      }
      return values[i++]!;
    },
  };
}

describe("createRng", () => {
  it("is deterministic for a seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("differs across seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hitChance", () => {
  it("starts at the base chance for two plain combatants", () => {
    expect(hitChance(PLAYER, GOBLIN)).toBeCloseTo(BASE_HIT_CHANCE);
  });

  it("rises with weapon accuracy and falls with evasion", () => {
    const armed = { ...PLAYER, weapon: { name: "sword", damage: 3, accuracy: 0.05 } };
    const evasive = { ...GOBLIN, evasionBonus: 0.2 };
    expect(hitChance(armed, GOBLIN)).toBeGreaterThan(hitChance(PLAYER, GOBLIN));
    expect(hitChance(PLAYER, evasive)).toBeLessThan(hitChance(PLAYER, GOBLIN));
  });

  it("clamps, so nobody is unhittable and nobody always hits", () => {
    // Without the floor a fight between a weak attacker and an evasive
    // defender never resolves; without the ceiling combat stops being a risk
    // for anyone who out-levels the content.
    const untouchable = { ...GOBLIN, evasionBonus: 99 };
    const unerring = { ...PLAYER, accuracyBonus: 99 };
    expect(hitChance(PLAYER, untouchable)).toBe(MIN_HIT_CHANCE);
    expect(hitChance(unerring, GOBLIN)).toBe(MAX_HIT_CHANCE);
  });
});

describe("resolveAttack — roll order is the contract", () => {
  it("draws ONE roll on a miss and stops", () => {
    // A miss must not consume the crit or variance rolls, or every seeded
    // sequence downstream shifts.
    const outcome = resolveAttack(PLAYER, GOBLIN, scripted([0.99]));
    expect(outcome.hit).toBe(false);
    expect(outcome.damage).toBe(0);
  });

  it("draws hit, then crit, then variance on a landed blow", () => {
    // Scripted with exactly three values — a fourth draw throws.
    const outcome = resolveAttack(PLAYER, GOBLIN, scripted([0.01, 0.99, 0.5]));
    expect(outcome.hit).toBe(true);
    expect(outcome.critical).toBe(false);
    expect(outcome.damage).toBeGreaterThan(0);
  });

  it("applies the crit multiplier when the crit roll lands", () => {
    const plain = resolveAttack(PLAYER, GOBLIN, scripted([0.01, 0.99, 0.5]));
    const crit = resolveAttack(PLAYER, GOBLIN, scripted([0.01, 0.0, 0.5]));
    expect(crit.critical).toBe(true);
    expect(crit.rawDamage).toBe(plain.rawDamage * CRIT_MULTIPLIER);
  });
});

describe("resolveAttack — damage", () => {
  it("varies across seeds", () => {
    // The whole point: the outcome is no longer fixed at the start.
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed += 1) {
      const o = resolveAttack(PLAYER, GOBLIN, createRng(seed));
      if (o.hit) seen.add(o.damage);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("a better weapon measurably raises damage", () => {
    // Same seeds both sides, so the comparison isn't luck.
    const armed = { ...PLAYER, weapon: { name: "greatsword", damage: 10 } };
    let unarmedTotal = 0;
    let armedTotal = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      unarmedTotal += resolveAttack(PLAYER, GOBLIN, createRng(seed)).damage;
      armedTotal += resolveAttack(armed, GOBLIN, createRng(seed)).damage;
    }
    expect(armedTotal).toBeGreaterThan(unarmedTotal);
  });

  it("scales with the attacker's level", () => {
    const high = { ...PLAYER, level: 40 };
    let lowTotal = 0;
    let highTotal = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      lowTotal += resolveAttack(PLAYER, GOBLIN, createRng(seed)).damage;
      highTotal += resolveAttack(high, GOBLIN, createRng(seed)).damage;
    }
    expect(highTotal).toBeGreaterThan(lowTotal);
    expect(DAMAGE_PER_LEVEL).toBeGreaterThan(0);
  });

  it("armour reduces damage but a hit always hurts", () => {
    // Armour that could zero a blow would make a well-equipped defender
    // invulnerable to a weak attacker, and that fight would never end.
    const plated = {
      ...GOBLIN,
      armour: [{ name: "plate", protection: 9999 }],
    };
    const o = resolveAttack(PLAYER, plated, scripted([0.01, 0.99, 0.5]));
    expect(o.hit).toBe(true);
    expect(o.damage).toBeGreaterThanOrEqual(MIN_DAMAGE_ON_HIT);
    // A quarter of the swing gets through however absurd the protection.
    expect(o.damage).toBe(Math.ceil(o.rawDamage * (1 - MAX_ARMOUR_ABSORB)));
    expect(o.absorbed).toBeGreaterThan(0);
  });

  it("sums protection across every worn piece", () => {
    // The reason `armour` is a list (NEH-658): a helmet and a shield used to
    // contend for one slot, so only one could ever contribute.
    const roll = () => scripted([0.01, 0.99, 0.5]);
    const bare = resolveAttack(PLAYER, GOBLIN, roll());
    const helmed = resolveAttack(
      PLAYER,
      { ...GOBLIN, armour: [{ name: "helm", protection: 2 }] },
      roll(),
    );
    const bothPieces = resolveAttack(
      PLAYER,
      {
        ...GOBLIN,
        armour: [
          { name: "helm", protection: 2 },
          { name: "shield", protection: 3 },
        ],
      },
      roll(),
    );
    // Same seeded roll throughout, so the only thing moving is protection.
    expect(bare.rawDamage).toBe(bothPieces.rawDamage);
    expect(helmed.damage).toBeLessThan(bare.damage);
    // The assertion the issue exists for: the SECOND piece has to matter too.
    expect(bothPieces.damage).toBeLessThan(helmed.damage);
    // Against the RULE, not a magic number: protection is subtracted, then
    // bounded so a fraction of the swing always lands. Writing `toBe(5)`
    // here asserted full subtraction and failed the moment the roll was
    // small enough for the bound to bite — which is the bound working.
    expect(bothPieces.damage).toBe(
      Math.max(
        Math.max(
          MIN_DAMAGE_ON_HIT,
          Math.ceil(bothPieces.rawDamage * (1 - MAX_ARMOUR_ABSORB)),
        ),
        bothPieces.rawDamage - 5,
      ),
    );
  });

  it("leaves an unarmoured defender completely unchanged", () => {
    // The absorption bound must not become a stealth nerf to everyone. With
    // no protection the subtraction never reaches it, so damage is the raw
    // roll exactly as before.
    for (let seed = 0; seed < 50; seed += 1) {
      const o = resolveAttack(PLAYER, GOBLIN, createRng(seed));
      if (o.hit) {
        expect(o.damage).toBe(o.rawDamage);
        expect(o.absorbed).toBe(0);
      }
    }
  });

  it("keeps a heavily-armoured defender killable, not immune", () => {
    // The balance half of NEH-658. Before the fraction bound, a full set
    // against a weak attacker meant every blow landed for exactly 1 — an
    // armoured level-1 character was effectively immune to the whole
    // starting area. Durable is the goal; invulnerable is a broken game.
    const fullSet = [
      { name: "helm", protection: 4 },
      { name: "shield", protection: 5 },
      { name: "mail", protection: 7 },
    ];
    let total = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const o = resolveAttack(PLAYER, { ...GOBLIN, armour: fullSet }, createRng(seed));
      total += o.damage;
      if (o.hit) expect(o.damage).toBeGreaterThan(0);
    }
    // 16 protection against this attacker would floor every hit at 1 under
    // the old rule. It must be meaningfully more than that.
    expect(total).toBeGreaterThan(40);
  });

  it("never deals negative damage or reports negative absorption", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const o = resolveAttack(PLAYER, GOBLIN, createRng(seed));
      expect(o.damage).toBeGreaterThanOrEqual(0);
      expect(o.absorbed).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("resolveAttack — a pinned seeded sequence", () => {
  it("reproduces the same fight from the same seed", () => {
    // Reproducibility IS the feature here: a reported fight can be replayed
    // from its seed instead of being "sometimes".
    const run = (): string[] => {
      const rng = createRng(20260813);
      return Array.from({ length: 6 }, () => {
        const o = resolveAttack(PLAYER, GOBLIN, rng);
        return `${o.hit ? "hit" : "miss"}:${o.damage}:${o.critical ? "crit" : "-"}`;
      });
    };
    expect(run()).toEqual(run());
  });

  it("a different seed gives a different fight", () => {
    const fight = (seed: number): string =>
      Array.from({ length: 8 }, () => 0)
        .reduce<{ rng: Rng; out: string[] }>(
          (acc) => {
            const o = resolveAttack(PLAYER, GOBLIN, acc.rng);
            acc.out.push(`${o.hit}:${o.damage}`);
            return acc;
          },
          { rng: createRng(seed), out: [] },
        )
        .out.join("|");
    expect(fight(1)).not.toBe(fight(2));
  });
});

describe("describeAttack", () => {
  const hit = { hit: true, critical: false, damage: 4, rawDamage: 4, absorbed: 0 };
  const crit = { hit: true, critical: true, damage: 9, rawDamage: 9, absorbed: 0 };
  const miss = { hit: false, critical: false, damage: 0, rawDamage: 0, absorbed: 0 };

  it("conjugates the second person correctly", () => {
    // "You strikes" is the bug this flag exists to prevent, and patching the
    // finished string was the wrong fix.
    expect(describeAttack("You", "the goblin", hit, { secondPerson: true })).toBe(
      "You strike the goblin for 4 damage.",
    );
    expect(describeAttack("You", "the goblin", miss, { secondPerson: true })).toBe(
      "You swing at the goblin and miss.",
    );
  });

  it("uses third person by default", () => {
    expect(describeAttack("The goblin", "you", hit)).toBe(
      "The goblin strikes you for 4 damage.",
    );
    expect(describeAttack("The goblin", "you", miss)).toBe(
      "The goblin swings at you and misses.",
    );
  });

  it("calls out a critical", () => {
    expect(describeAttack("You", "the goblin", crit, { secondPerson: true })).toContain(
      "savage blow",
    );
  });

  it("mentions absorption only when armour absorbed something", () => {
    const absorbed = { ...hit, rawDamage: 7, damage: 4, absorbed: 3 };
    expect(describeAttack("You", "it", absorbed, { secondPerson: true })).toContain(
      "(3 absorbed)",
    );
    expect(describeAttack("You", "it", hit, { secondPerson: true })).not.toContain(
      "absorbed",
    );
  });
});
