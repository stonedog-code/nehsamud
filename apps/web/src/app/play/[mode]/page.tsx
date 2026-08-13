import { notFound } from "next/navigation";
import Link from "next/link";
import { deriveStats, findClass, findRace } from "@/lib/catalog";
import { isGameMode, isModeEnabled, MODES } from "@/lib/modes";
import { Terminal } from "@/components/Terminal";

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

      <div className="notice">
        <h2>Preview build</h2>
        <p>
          The world you are about to see is a local preview. It responds to
          movement and <code>look</code>, but it is not yet the live game
          server, so nothing you do here is saved.
        </p>
      </div>

      <Terminal
        mode={mode}
        character={{
          name: characterName,
          race,
          characterClass,
          stats: deriveStats(race, characterClass),
        }}
      />
    </>
  );
}
