import {
  GAME_MODES,
  MODES,
  enabledModes,
  isGameMode,
  isModeEnabled,
  modeDefinition,
} from "../modes";

describe("mode capabilities", () => {
  it("gives Exploration no hostiles, no combat, no PVP, no looting", () => {
    // This is the senior-safe build's whole premise (PRD-0001 R3, R4).
    // If this test ever needs changing, the product decision changed.
    expect(MODES.exploration.capabilities).toEqual({
      hostiles: false,
      combat: false,
      playerVersusPlayer: false,
      looting: false,
      scripting: false,
    });
  });

  it("gives PVE combat but never player-versus-player or looting", () => {
    expect(MODES.pve.capabilities.combat).toBe(true);
    expect(MODES.pve.capabilities.playerVersusPlayer).toBe(false);
    expect(MODES.pve.capabilities.looting).toBe(false);
  });

  it("gives PVP everything, including looting", () => {
    expect(MODES.pvp.capabilities.playerVersusPlayer).toBe(true);
    expect(MODES.pvp.capabilities.looting).toBe(true);
  });

  it("never enables looting without player-versus-player", () => {
    // Looting is a consequence of beating another player, so it cannot be
    // reachable in a mode where that cannot happen.
    for (const mode of GAME_MODES) {
      const caps = MODES[mode].capabilities;
      if (caps.looting) expect(caps.playerVersusPlayer).toBe(true);
    }
  });

  it("never enables combat without hostiles to fight", () => {
    for (const mode of GAME_MODES) {
      const caps = MODES[mode].capabilities;
      if (caps.combat) expect(caps.hostiles).toBe(true);
    }
  });

  it("exposes a definition for every declared mode", () => {
    for (const mode of GAME_MODES) {
      expect(modeDefinition(mode).id).toBe(mode);
      expect(modeDefinition(mode).name).not.toHaveLength(0);
    }
  });
});

describe("isGameMode", () => {
  it.each(GAME_MODES)("accepts %s", (mode) => {
    expect(isGameMode(mode)).toBe(true);
  });

  it.each([["creative"], [""], ["EXPLORATION"]])(
    "rejects %p",
    (value) => {
      expect(isGameMode(value)).toBe(false);
    },
  );

  it("rejects non-strings", () => {
    expect(isGameMode(undefined)).toBe(false);
    expect(isGameMode(null)).toBe(false);
    expect(isGameMode(2)).toBe(false);
    expect(isGameMode({ mode: "pvp" })).toBe(false);
  });
});

describe("enabledModes", () => {
  it("serves every mode when unset, which is the dev-site default", () => {
    expect(enabledModes({})).toEqual([...GAME_MODES]);
    expect(enabledModes({ NEHSAMUD_MODES: "   " })).toEqual([...GAME_MODES]);
  });

  it("narrows to exactly what the deployment names", () => {
    expect(enabledModes({ NEHSAMUD_MODES: "exploration" })).toEqual([
      "exploration",
    ]);
  });

  it("tolerates whitespace, casing, and duplicates", () => {
    expect(enabledModes({ NEHSAMUD_MODES: " PVP , pve ,pvp" })).toEqual([
      "pve",
      "pvp",
    ]);
  });

  it("returns the canonical order regardless of how the env lists them", () => {
    expect(enabledModes({ NEHSAMUD_MODES: "pvp,exploration,pve" })).toEqual([
      "exploration",
      "pve",
      "pvp",
    ]);
  });

  it("drops unrecognised entries rather than widening or throwing", () => {
    // A typo must narrow what is served, never open a mode this host was not
    // meant to run.
    expect(enabledModes({ NEHSAMUD_MODES: "exploration,pvpp" })).toEqual([
      "exploration",
    ]);
    expect(enabledModes({ NEHSAMUD_MODES: "nonsense" })).toEqual([]);
  });
});

describe("isModeEnabled", () => {
  it("refuses a mode this deployment does not serve", () => {
    const env = { NEHSAMUD_MODES: "exploration" };
    expect(isModeEnabled("exploration", env)).toBe(true);
    expect(isModeEnabled("pvp", env)).toBe(false);
    expect(isModeEnabled("pve", env)).toBe(false);
  });
});
