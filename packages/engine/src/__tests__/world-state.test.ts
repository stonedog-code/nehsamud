import { WorldState } from "../world/world-state.js";

describe("WorldState hydration + lookup", () => {
  it("hydrates rooms by id and enumKey", () => {
    const w = new WorldState();
    w.hydrate([
      {
        id: "r1",
        enumKey: "ROOM_ONE",
        name: "Room 1",
        description: "desc",
        exits: {},
        environment: null,
        imageName: null,
      },
    ]);
    expect(w.roomCount()).toBe(1);
    expect(w.getRoom("r1")?.name).toBe("Room 1");
    expect(w.getRoomByEnumKey("ROOM_ONE")?.name).toBe("Room 1");
  });

  it("groups NPCs by their roomId", () => {
    const w = new WorldState();
    w.hydrate(
      [
        {
          id: "r1",
          enumKey: "ROOM_ONE",
          name: "Room 1",
          description: "",
          exits: {},
          environment: null,
          imageName: null,
        },
      ],
      [
        {
          id: "n1",
          slug: "alice",
          name: "Alice",
          description: "",
          roomId: "r1",
          pronoun: "she",
          alignment: "neutral",
          intelligenceMode: "canned",
          dialogLines: [],
          interests: [],
        },
        {
          id: "n2",
          slug: "bob",
          name: "Bob",
          description: "",
          roomId: "r1",
          pronoun: "he",
          alignment: "neutral",
          intelligenceMode: "canned",
          dialogLines: [],
          interests: [],
        },
        {
          id: "n3",
          slug: "absent",
          name: "Absent",
          description: "",
          roomId: null,
          pronoun: "they",
          alignment: "neutral",
          intelligenceMode: "canned",
          dialogLines: [],
          interests: [],
        },
      ],
    );
    expect(w.getNpcsInRoom("r1").map((n) => n.slug).sort()).toEqual([
      "alice",
      "bob",
    ]);
    expect(w.getNpcsInRoom("r2")).toEqual([]);
    expect(w.getNpcBySlug("absent")?.roomId).toBeNull();
  });

  it("findNpcByName matches by slug, name, or first-name within a room scope", () => {
    const w = new WorldState();
    w.hydrate(
      [
        {
          id: "r1",
          enumKey: "ROOM_ONE",
          name: "R",
          description: "",
          exits: {},
          environment: null,
          imageName: null,
        },
        {
          id: "r2",
          enumKey: "ROOM_TWO",
          name: "R",
          description: "",
          exits: {},
          environment: null,
          imageName: null,
        },
      ],
      [
        {
          id: "n1",
          slug: "merchant-henrik",
          name: "Henrik the Merchant",
          description: "",
          roomId: "r1",
          pronoun: "he",
          alignment: "neutral",
          intelligenceMode: "canned",
          dialogLines: [],
          interests: [],
        },
        {
          id: "n2",
          slug: "shopkeeper",
          name: "Shopkeeper",
          description: "",
          roomId: "r2",
          pronoun: "they",
          alignment: "neutral",
          intelligenceMode: "canned",
          dialogLines: [],
          interests: [],
        },
      ],
    );

    // First-name match within scope
    expect(w.findNpcByName("henrik", "r1")?.slug).toBe("merchant-henrik");
    // Slug match within scope
    expect(w.findNpcByName("merchant-henrik", "r1")?.slug).toBe("merchant-henrik");
    // Scope respected: henrik isn't in r2
    expect(w.findNpcByName("henrik", "r2")).toBeUndefined();
    // Global fallback (no scope) still finds him
    expect(w.findNpcByName("henrik")?.slug).toBe("merchant-henrik");
    // Empty query returns undefined
    expect(w.findNpcByName("")).toBeUndefined();
  });
});
