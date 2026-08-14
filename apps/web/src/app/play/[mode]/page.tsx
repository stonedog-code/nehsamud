import { notFound } from "next/navigation";
import Link from "next/link";
import { OPTION_GROUPS, deriveStats, resolveSelection } from "@/lib/catalog";
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

  // One query parameter per axis the pack declares, alongside the name.
  // Until this read existed, the creation form collected the answers,
  // previewed their effect, and this page dropped them on the floor — every
  // character was whatever the server picked by default, and nothing
  // anywhere said so.
  //
  // An unanswered or unrecognised axis is treated exactly like a missing
  // name: back to creation. Substituting a default here is what the bug was
  // — a silent fallback and a working selection look identical from outside.
  const selection = resolveSelection(
    Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        typeof value === "string" ? value : undefined,
      ]),
    ),
  );

  if (!characterName || !selection) {
    // "a name, a race and a class" for this pack; just "a name" for one with
    // no axes. Built from the declared groups so the sentence cannot promise
    // a question the form does not ask.
    const names = OPTION_GROUPS.map((g) => `a ${g.name.toLowerCase()}`);
    const requirements = names.length
      ? `, ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]}`
      : "";
    return (
      <>
        <header className="page-header">
          <h1>No character yet</h1>
          <p>
            You need a character — a name{requirements} — before you can
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

  // "an Elf Mage" for a pack with those axes, nothing at all for a pack with
  // none — where a player is simply themselves and there is no shorthand to
  // print.
  const described = selection.map((s) => s.option.name).join(" ");

  // Live when an engine is configured for this deployment, preview otherwise.
  // Not a fallback the page takes silently: which one is running changes what
  // the words on screen mean, so it changes what the page says.
  const live = engineUrl() !== undefined;

  return (
    <>
      <header className="page-header">
        <h1>{definition.name}</h1>
        <p>
          Playing as <strong>{characterName}</strong>
          {described ? `, a ${described}` : ""}. Type <code>help</code> to see
          what you can do, or a direction to move.
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
            options: Object.fromEntries(
              selection.map((s) => [s.group.key, s.option.key]),
            ),
          }}
        />
      ) : (
        <Terminal
          mode={mode}
          character={{
            name: characterName,
            selection,
            stats: deriveStats(selection),
          }}
        />
      )}
    </>
  );
}
