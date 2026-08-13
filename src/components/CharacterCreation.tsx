"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLASSES,
  RACES,
  deriveStats,
  findClass,
  findRace,
  validateCharacterName,
} from "@/lib/catalog";
import type { GameMode } from "@/lib/modes";

/**
 * Race + class + name, with a live stat preview.
 *
 * The preview exists because PRD-0001 R9 requires the choice to matter. Until
 * the engine applies these modifiers the numbers describe intent rather than
 * behaviour, which the caption says plainly — a preview that quietly disagrees
 * with the server is worse than no preview.
 */
export function CharacterCreation({ mode }: { mode: GameMode }) {
  const router = useRouter();
  const [raceKey, setRaceKey] = useState(RACES[0].key);
  const [classKey, setClassKey] = useState(CLASSES[0].key);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const stats = useMemo(() => {
    const race = findRace(raceKey);
    const characterClass = findClass(classKey);
    if (!race || !characterClass) return undefined;
    return deriveStats(race, characterClass);
  }, [raceKey, classKey]);

  // Only surface the error once they've tried to submit, so the form doesn't
  // scold someone who has simply not finished typing.
  const nameError = validateCharacterName(name);
  const showNameError = submitted && nameError !== undefined;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (nameError) return;

    const query = new URLSearchParams({
      name: name.trim(),
      race: raceKey,
      class: classKey,
    });
    router.push(`/play/${mode}?${query.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset>
        <legend>Choose a race</legend>
        <div className="option-grid">
          {RACES.map((race) => (
            <label className="option" key={race.key}>
              <input
                type="radio"
                name="race"
                value={race.key}
                checked={raceKey === race.key}
                onChange={() => setRaceKey(race.key)}
              />
              <span className="option-name">{race.name}</span>
              <span className="option-detail">{race.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Choose a class</legend>
        <div className="option-grid">
          {CLASSES.map((characterClass) => (
            <label className="option" key={characterClass.key}>
              <input
                type="radio"
                name="class"
                value={characterClass.key}
                checked={classKey === characterClass.key}
                onChange={() => setClassKey(characterClass.key)}
              />
              <span className="option-name">{characterClass.name}</span>
              <span className="option-detail">{characterClass.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {stats && (
        <dl className="stat-preview" aria-live="polite">
          <div>
            <dt>Health</dt>
            <dd>{stats.hp}</dd>
          </div>
          <div>
            <dt>Damage</dt>
            <dd>{stats.damage}</dd>
          </div>
        </dl>
      )}

      <fieldset>
        <legend>Name your character</legend>
        <label className="field" htmlFor="character-name">
          Character name
        </label>
        <input
          id="character-name"
          type="text"
          value={name}
          autoComplete="off"
          aria-describedby={showNameError ? "character-name-error" : undefined}
          aria-invalid={showNameError}
          onChange={(event) => setName(event.target.value)}
        />
        {showNameError && (
          <p className="field-error" id="character-name-error" role="alert">
            {nameError}
          </p>
        )}
      </fieldset>

      <button className="button" type="submit">
        Enter the world
      </button>
    </form>
  );
}
