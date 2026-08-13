/**
 * NPC catalog. Non-hostile mobs that occupy a fixed room and can
 * be `talked` to; Phase 5's NPC dialog system will read
 * `intelligenceMode` to decide between canned reply cycling and
 * routing the prompt to the LLM (with canned-fallback when
 * /capabilities reports text generation unavailable).
 *
 * Ported from the original Python MUD (nehsa-net/websocket-mud), source_data/mobs_npcs.py.
 */

import type { NpcFixture } from "./types.js";

export const NPCS: NpcFixture[] = [
  {
    slug: "zofia",
    name: "Zofia",
    description:
      "The keeper of The Quiet Bed. Sharp-eyed, soft-voiced, and not to be crossed.",
    roomEnumKey: "TOWNSMEE_INN",
    pronoun: "she",
    alignment: "good",
    intelligenceMode: "canned",
    dialogLines: [
      "A room for the night? Two coppers, no questions.",
      "The market's open until dusk if you're after supplies.",
      "Mind the goblins on the south road.",
    ],
    interests: ["lodging", "directions", "rumors"],
  },
  {
    slug: "barkeep-mira",
    name: "Mira the Barkeep",
    description:
      "A square-shouldered woman with flour on her apron, polishing a tankard at the long bar.",
    roomEnumKey: "TOWNSMEE_TAVERN",
    pronoun: "she",
    alignment: "neutral",
    intelligenceMode: "canned",
    dialogLines: [
      "Stew's hot, ale's cold. What'll it be?",
      "Heard the merchant's expecting a caravan. Should be lively next market day.",
      "Don't mind the man in the corner. He's been here since before I was born.",
    ],
    interests: ["food", "drink", "rumors"],
  },
  {
    slug: "merchant-henrik",
    name: "Henrik the Merchant",
    description:
      "A ruddy-cheeked trader behind a crate stacked with goods.",
    roomEnumKey: "TOWNSMEE_MARKET",
    pronoun: "he",
    alignment: "neutral",
    intelligenceMode: "canned",
    dialogLines: [
      "Sword, shield, or supplies? I've got all three at fair prices.",
      "If you're heading north, you'll want the better blade.",
      "Trade caravan's due any day. Stock's tight until then.",
    ],
    interests: ["trade", "weapons", "armor"],
  },
  {
    slug: "innkeeper-gus",
    name: "Gus the Innkeeper",
    description:
      "A jovial round-faced man who somehow knows your name before you give it.",
    roomEnumKey: "TOWNSMEE_INN",
    pronoun: "he",
    alignment: "good",
    intelligenceMode: "canned",
    dialogLines: [
      "Welcome, welcome! First time in Townsmee?",
      "The third floor's a bit drafty. Take a second-floor room.",
      "Breakfast is included. Don't argue, just eat.",
    ],
    interests: ["lodging", "food", "directions"],
  },
  {
    slug: "guard-captain",
    name: "Captain Edred",
    description:
      "A weatherworn soldier in dented plate, leaning on the haft of a halberd.",
    roomEnumKey: "TOWNSMEE_TOWNSQUARE",
    pronoun: "he",
    alignment: "lawful_good",
    intelligenceMode: "canned",
    dialogLines: [
      "Behave yourself in town.",
      "We've had reports of bandits south of the gallows. Be careful out there.",
      "The sheriff's office is east of the square if you need to file a complaint.",
    ],
    interests: ["safety", "law", "rumors"],
  },
  {
    slug: "sheriff",
    name: "Sheriff Ana",
    description:
      "A tall woman with a star pinned to a leather coat. Her hand never strays far from her side-arm.",
    roomEnumKey: "TOWNSMEE_SHERIFF",
    pronoun: "she",
    alignment: "lawful_good",
    intelligenceMode: "canned",
    dialogLines: [
      "State your business.",
      "Bandits, yes. Goblins, yes. Wolves, also yes. Pick a problem, we have it.",
      "If you've got something to report, make it quick.",
    ],
    interests: ["law", "rumors", "bandits"],
  },
  {
    slug: "blacksmith",
    name: "Tomas the Blacksmith",
    description:
      "Broad-shouldered, soot-stained, with arms that could lift a horse and probably have.",
    roomEnumKey: "TOWNSMEE_BLACKSMITH",
    pronoun: "he",
    alignment: "neutral",
    intelligenceMode: "canned",
    dialogLines: [
      "What needs forging?",
      "I take iron in trade if you've got it. Quality only.",
      "Don't lean on that anvil — it's hot.",
    ],
    interests: ["weapons", "armor", "trade"],
  },
  {
    slug: "princess",
    name: "Princess Lirien",
    description:
      "A young woman in a fine but travel-worn dress, watching everything with calm attention.",
    roomEnumKey: "TOWNSMEE_INN",
    pronoun: "she",
    alignment: "good",
    intelligenceMode: "canned",
    dialogLines: [
      "Don't bow. Please. I came here to be left alone.",
      "If you're heading north on the sunroad, I'd appreciate hearing what you see.",
      "My father thinks I'm in a convent. Don't correct him.",
    ],
    interests: ["rumors", "north-road", "court"],
  },
  {
    slug: "maximus",
    name: "Maximus",
    description:
      "An aging warrior with greying hair and a worn longsword across his back. Pours himself ale " +
      "with steady hands.",
    roomEnumKey: "TOWNSMEE_INN",
    pronoun: "he",
    alignment: "neutral",
    intelligenceMode: "canned",
    dialogLines: [
      "Met a goblin once that took six arrows. You always carry six? Carry seven.",
      "There's an old fort in the hills. Don't go alone.",
      "Stew's good here. Bread's better.",
    ],
    interests: ["combat", "rumors", "hills"],
  },
  {
    slug: "young-distraught-woman",
    name: "Distraught Woman",
    description:
      "A young woman gesturing through the window into the sheriff's back office, her voice high " +
      "and shaking.",
    roomEnumKey: "TOWNSMEE_SHERIFF",
    pronoun: "she",
    alignment: "good",
    intelligenceMode: "canned",
    dialogLines: [
      "They took him! They TOOK him! Why won't anyone DO anything?",
      "He went south, just past the gallows. Three days, no word.",
      "Please. Anyone.",
    ],
    interests: ["bandits", "south-road", "missing-person"],
  },
];
