"use client";

import { useEffect, useRef, useState } from "react";
import { applyCommand, initialState } from "@/lib/preview-world";
import type { GameMode } from "@/lib/modes";

/**
 * The play surface: a transcript and a command line.
 *
 * The transcript is an `aria-live` log so a screen-reader player hears what
 * the world says without hunting for it — in a text game the transcript *is*
 * the game, so it cannot be a silent region that only sighted players notice
 * changing.
 */
export function Terminal({
  mode,
  characterName,
}: {
  mode: GameMode;
  characterName: string;
}) {
  const [state, setState] = useState(() => initialState(characterName));
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the transcript grows.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [state.lines]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (input.trim() === "") return;
    setState((current) => applyCommand(current, input, mode));
    setInput("");
  }

  return (
    <>
      <div
        className="terminal"
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label="Game transcript"
        tabIndex={0}
        data-testid="transcript"
      >
        {state.lines.map((line, index) => (
          <div
            // Lines are append-only and never reordered, so the index is a
            // stable identity here.
            key={index}
            className={
              line.kind === "room"
                ? "room-name"
                : line.kind === "echo"
                  ? "echo"
                  : line.kind === "system"
                    ? "system"
                    : undefined
            }
          >
            {line.text}
          </div>
        ))}
      </div>

      <form className="command-row" onSubmit={submit}>
        <label className="skip-link" htmlFor="command">
          Command
        </label>
        <input
          id="command"
          type="text"
          value={input}
          autoComplete="off"
          autoFocus
          placeholder="Type a command, e.g. north"
          onChange={(event) => setInput(event.target.value)}
          data-testid="command-input"
        />
        <button className="button" type="submit">
          Send
        </button>
      </form>
    </>
  );
}
