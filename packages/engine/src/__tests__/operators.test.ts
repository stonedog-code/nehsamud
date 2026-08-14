/**
 * The operator-authority model (NEH-656).
 *
 * Every assertion here is about the same property: the failure mode of this
 * model must be *closed*. A misconfiguration, a missing variable, a stray
 * comma must all end in "not an operator" — an authorisation check that
 * fails open is not a check.
 */

import { OPERATORS_ENV, isOperator, resolveOperators } from "../operators.js";

describe("resolveOperators", () => {
  it("reads a comma-separated list of owner ids", () => {
    const set = resolveOperators({ [OPERATORS_ENV]: "owner-a,owner-b" });
    expect([...set].sort()).toEqual(["owner-a", "owner-b"]);
  });

  it("tolerates the whitespace a human editing a secret leaves behind", () => {
    const set = resolveOperators({ [OPERATORS_ENV]: " owner-a , owner-b ,, " });
    expect([...set].sort()).toEqual(["owner-a", "owner-b"]);
    // Notably NOT an empty-string member. A set containing "" would make
    // `isOperator(undefined ?? "")` true for anyone whose id failed to
    // resolve — the exact shape of an accidental grant.
    expect(set.has("")).toBe(false);
  });

  it("yields nobody when the variable is unset", () => {
    expect(resolveOperators({}).size).toBe(0);
  });

  it("yields nobody when the variable is empty or whitespace", () => {
    expect(resolveOperators({ [OPERATORS_ENV]: "" }).size).toBe(0);
    expect(resolveOperators({ [OPERATORS_ENV]: "   " }).size).toBe(0);
    expect(resolveOperators({ [OPERATORS_ENV]: ",,," }).size).toBe(0);
  });
});

describe("isOperator", () => {
  const operators = resolveOperators({ [OPERATORS_ENV]: "owner-a" });

  it("recognises a listed owner", () => {
    expect(isOperator("owner-a", operators)).toBe(true);
  });

  it("refuses an unlisted owner", () => {
    expect(isOperator("owner-b", operators)).toBe(false);
  });

  it("refuses an absent owner rather than treating it as a wildcard", () => {
    expect(isOperator(undefined, operators)).toBe(false);
    expect(isOperator("", operators)).toBe(false);
  });

  it("is case-sensitive, because these are ids and not names", () => {
    // Widening is the direction that costs something. Two owner ids that
    // differ only in case are two different people.
    expect(isOperator("OWNER-A", operators)).toBe(false);
  });

  it("refuses everyone when no operators are configured", () => {
    expect(isOperator("owner-a", resolveOperators({}))).toBe(false);
  });
});
