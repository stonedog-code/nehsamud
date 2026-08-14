"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  OPTION_GROUPS,
  deriveStats,
  resolveSelection,
  validateCharacterName,
} from "@/lib/catalog";
import type { GameMode } from "@/lib/modes";

/**
 * One question per axis the pack declares, plus a name, with a live stat
 * preview.
 *
 * The form used to have two hardcoded fieldsets, "Choose a race" and "Choose
 * a class", because the engine had exactly those two tables. It now renders
 * a fieldset per declared group: a pack that adds an axis gets a question
 * for it, and a pack that declares none gets a form that asks only for a
 * name. That last case is the care-centre world, where you are simply a
 * resident — so it must not look like a form that failed to load.
 *
 * The preview exists because PRD-0001 R9 requires the choice to matter, and
 * the numbers now describe BEHAVIOUR: `deriveStats` delegates to the
 * engine's own `deriveCharacter`, so what is shown here is by construction
 * what the server will write into the row (NEH-621).
 */
export function CharacterCreation({ mode }: { mode: GameMode }) {
  const router = useRouter();
  // Seeded with the first option of each group, so the form opens on a valid
  // selection rather than on nothing.
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      OPTION_GROUPS.flatMap((group) =>
        group.options[0] ? [[group.key, group.options[0].key]] : [],
      ),
    ),
  );
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const stats = useMemo(() => {
    const selection = resolveSelection(answers);
    return selection ? deriveStats(selection) : undefined;
  }, [answers]);

  // Only surface the error once they've tried to submit, so the form doesn't
  // scold someone who has simply not finished typing.
  const nameError = validateCharacterName(name);
  const showNameError = submitted && nameError !== undefined;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (nameError) return;

    const query = new URLSearchParams({ name: name.trim(), ...answers });
    router.push(`/play/${mode}?${query.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {OPTION_GROUPS.map((group) => (
        <fieldset key={group.key}>
          <legend>Choose a {group.name.toLowerCase()}</legend>
          <div className="option-grid">
            {group.options.map((option) => (
              <label className="option" key={option.key}>
                <input
                  type="radio"
                  name={group.key}
                  value={option.key}
                  checked={answers[group.key] === option.key}
                  onChange={() =>
                    setAnswers((current) => ({
                      ...current,
                      [group.key]: option.key,
                    }))
                  }
                />
                <span className="option-name">{option.name}</span>
                <span className="option-detail">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {stats && (
        <dl className="stat-preview" aria-live="polite">
          <div>
            <dt>Health</dt>
            <dd data-testid="preview-hp">{stats.hp}</dd>
          </div>
          <div>
            <dt>Damage</dt>
            <dd data-testid="preview-damage">{stats.damage}</dd>
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
