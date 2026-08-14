import { notFound } from "next/navigation";
import Link from "next/link";
import { deriveStats, findClass, findRace } from "@/lib/catalog";
import { isGameMode, isModeEnabled, MODES } from "@/lib/modes";
import { LiveTerminal } from "@/components/LiveTerminal";
import { Terminal } from "@/components/Terminal";
import { engineUrl } from "@/lib/mud-client";

/**
 * The play surface for one mode.
 *
 * Same double validation as the creation page: a real mode, enabled on this
 * deployment. The terminal below is a local stub — it renders the town and
 * echoes commands so the shell and its e2e coverage exist before the engine
 * does. The live WebSocket client replaces it once the engine extraction
 * lands.
 */
export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode } = await params;
  if (!isGameMode(mode) || !isModeEnabled(mode)) notFound();

  const query = await searchParams;
  const characterName = typeof query.name === "string" ? query.name : undefined;

  // Race and class travel in the query alongside the name. Until this read
  // existed, the creation form collected both, previewed their effect, and
  // this page dropped them on the floor — every character was whatever the
  // server picked by default, and nothing anywhere said so.
  const race = typeof query.race === "string" ? findRace(query.race) : undefined;
  const characterClass =
    typeof query.class === "string" ? findClass(query.class) : undefined;

  // An unrecognised race or class is treated exactly like a missing name:
  // back to creation. Substituting a default here is what the bug was —
  // a silent fallback and a working selection look identical from the outside.
  if (!characterName || !race || !characterClass) {
    return (
      <>
        <header className="page-header">
          <h1>No character yet</h1>
          <p>
            You need a character — a name, a race and a class — before you can
            enter the world.
          </p>
        </header>
        <Link className="button" href={`/play/${mode}/create`}>
          Create a character
        </Link>
      </>
    );
  }

  const definition = MODES[mode];

  // Live when an engine is configured for this deployment, preview otherwise.
  // Not a fallback the page takes silently: which one is running changes what
  // the words on screen mean, so it changes what the page says.
  const live = engineUrl() !== undefined;

  return (
    <>
      <header className="page-header">
        <h1>{definition.name}</h1>
        <p>
          Playing as <strong>{characterName}</strong>, a {race.name}{" "}
          {characterClass.name}. Type <code>help</code> to see what you can
          do, or a direction to move.
        </p>
      </header>

      {live ? (
        <div className="notice">
          <h2>Demo world</h2>
          <p>
            This is the real game engine. Characters here are anonymous — a
            new one each visit — so nothing you do is kept.
          </p>
        </div>
      ) : (
        <div className="notice">
          <h2>Preview build</h2>
          <p>
            No game engine is configured for this build, so the world below is
            a small in-browser stand-in. It answers movement and{" "}
            <code>look</code> and nothing else.
          </p>
        </div>
      )}

      {live ? (
        <LiveTerminal
          mode={mode}
          character={{
            name: characterName,
            race: race.key,
            characterClass: characterClass.key,
          }}
        />
      ) : (
        <Terminal
          mode={mode}
          character={{
            name: characterName,
            race,
            characterClass,
            stats: deriveStats(race, characterClass),
          }}
        />
      )}
    </>
  );
}
