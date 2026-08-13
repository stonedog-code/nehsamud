import { notFound } from "next/navigation";
import { isGameMode, isModeEnabled, MODES } from "@/lib/modes";
import { CharacterCreation } from "@/components/CharacterCreation";

/**
 * Character creation for one mode.
 *
 * The mode arrives in the URL, so it is validated twice: it must name a real
 * mode, and that mode must be enabled on this deployment. An Exploration-only
 * host therefore 404s `/play/pvp/create` rather than rendering it — the URL is
 * client-supplied and PRD-0001 R2 says client input must never select a mode.
 */
export default async function CreatePage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!isGameMode(mode) || !isModeEnabled(mode)) notFound();

  const definition = MODES[mode];

  return (
    <>
      <header className="page-header">
        <h1>Create your character</h1>
        <p>
          You are entering <strong>{definition.name}</strong>.{" "}
          {definition.tagline}
        </p>
      </header>

      <CharacterCreation mode={mode} />
    </>
  );
}

export function generateStaticParams() {
  return [];
}
