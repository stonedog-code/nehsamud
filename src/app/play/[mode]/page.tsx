import { notFound } from "next/navigation";
import Link from "next/link";
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

  // No character means someone reached this URL directly. Send them to create
  // one rather than dropping them into a world as nobody.
  if (!characterName) {
    return (
      <>
        <header className="page-header">
          <h1>No character yet</h1>
          <p>You need a character before you can enter the world.</p>
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
          Playing as <strong>{characterName}</strong>. Type{" "}
          <code>help</code> to see what you can do, or a direction to move.
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

      <Terminal mode={mode} characterName={characterName} />
    </>
  );
}
