import Link from "next/link";
import { enabledModes, MODES } from "@/lib/modes";

/**
 * Mode picker.
 *
 * Server component on purpose: `enabledModes()` reads server configuration,
 * so a deployment serving only Exploration never sends the other two to the
 * browser at all. A client-side filter would ship them and hide them.
 */
export default function HomePage() {
  const modes = enabledModes();

  return (
    <>
      <header className="page-header">
        <h1>NehsaMUD</h1>
        <p>
          A world made of words. You move by typing a direction — north, south,
          east, west, and the corners between them — and the world tells you
          what you find.
        </p>
      </header>

      {modes.length === 0 ? (
        <div className="notice">
          <h2>No modes are available</h2>
          <p>
            This site is not currently serving any version of the game. Please
            try again later.
          </p>
        </div>
      ) : (
        <ul className="mode-grid" style={{ listStyle: "none", padding: 0 }}>
          {modes.map((id) => {
            const mode = MODES[id];
            const { capabilities: caps } = mode;
            return (
              <li key={id} className="mode-card">
                <h2>{mode.name}</h2>
                <p className="tagline">{mode.tagline}</p>
                <p className="description">{mode.description}</p>

                <ul className="capability-list">
                  <Capability label="Monsters" on={caps.monsters} />
                  <Capability label="Combat" on={caps.combat} />
                  <Capability label="Player combat" on={caps.playerVersusPlayer} />
                  <Capability label="Looting" on={caps.looting} />
                  <Capability label="Scripting" on={caps.scripting} />
                </ul>

                <Link className="button" href={`/play/${id}/create`}>
                  Create a character in {mode.name}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Capability chip. The on/off state is carried by the word "yes"/"no" as well
 * as the check glyph and the border colour, so it survives both monochrome
 * rendering and a screen reader.
 */
function Capability({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="capability" data-on={on}>
      <span aria-hidden="true">{on ? "✓" : "—"}</span>
      <span>
        {label}: {on ? "yes" : "no"}
      </span>
    </li>
  );
}
