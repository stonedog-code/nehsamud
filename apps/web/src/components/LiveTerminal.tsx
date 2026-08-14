"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  engineUrl,
  linesForFrame,
  parseServerFrame,
  type ClientFrame,
  type Line,
} from "@/lib/mud-client";
import type { GameMode } from "@/lib/modes";

/**
 * The play surface, connected to a real engine.
 *
 * The scaffold's Terminal talks to an in-browser preview world, which was the
 * right call before an engine existed — it made the shell and its e2e
 * coverage real ahead of the extraction. It also meant that every verb,
 * every item and every room built since was unreachable from this app: the
 * two halves were finished and not joined.
 *
 * The connection sequence is fixed and the order matters:
 *
 *   1. POST /api/mud/dev-token          — an identity the engine will accept
 *   2. AUTH                             — the engine answers AUTH_OK, and for
 *                                         a brand-new user asks for a name
 *   3. CREATE_CHARACTER                 — name, race and class in one frame,
 *                                         because this client already has all
 *                                         three from the creation screen
 *
 * Step 3 uses the structured frame rather than replaying the conversational
 * `create <name>` flow: that flow exists for terminal players who have not
 * been asked yet, and making a client with a full picker pretend otherwise
 * would be theatre.
 */

export interface LiveCharacter {
  name: string;
  race: string;
  characterClass: string;
}

type Status = "connecting" | "playing" | "failed";

export function LiveTerminal({
  mode,
  character,
}: {
  mode: GameMode;
  character: LiveCharacter;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("connecting");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const append = useCallback((...added: Line[]) => {
    if (added.length > 0) setLines((current) => [...current, ...added]);
  }, []);

  useEffect(() => {
    const url = engineUrl();
    if (!url) {
      setStatus("failed");
      append({
        kind: "system",
        text: "No engine is configured for this build.",
      });
      return;
    }

    let cancelled = false;
    let socket: WebSocket | undefined;

    async function connect(): Promise<void> {
      let token: string;
      try {
        const response = await fetch("/api/mud/dev-token", { method: "POST" });
        if (!response.ok) throw new Error(`token request failed`);
        const body = (await response.json()) as { token?: string };
        if (!body.token) throw new Error("token missing from response");
        token = body.token;
      } catch {
        if (cancelled) return;
        setStatus("failed");
        append({
          kind: "system",
          text: "Could not get a session for this world. It may not be running.",
        });
        return;
      }
      if (cancelled) return;

      socket = new WebSocket(url!);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        send(socket!, { type: "AUTH", token });
        // Creation is sent immediately rather than waiting for the engine to
        // ask. A returning userId already has a character and the engine
        // ignores this; a new one needs it, and waiting for the prompt would
        // mean parsing prose to decide whether it was asked.
        send(socket!, {
          type: "CREATE_CHARACTER",
          name: character.name,
          race: character.race,
          class: character.characterClass,
        });
        if (!cancelled) setStatus("playing");
      });

      socket.addEventListener("message", (event) => {
        const frame = parseServerFrame(String(event.data));
        if (frame) append(...linesForFrame(frame));
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;
        setStatus("failed");
        append({ kind: "system", text: "The connection to the world closed." });
      });

      socket.addEventListener("error", () => {
        if (cancelled) return;
        setStatus("failed");
      });
    }

    void connect();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
    // The character is fixed for the life of this page — it comes from the
    // URL — so reconnecting on every render would be a connection storm.
  }, [append, character.name, character.race, character.characterClass]);

  // Keep the newest line in view as the transcript grows.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const text = input.trim();
    if (text === "") return;
    const socket = socketRef.current;
    // Echo locally so the transcript reads as a conversation. The engine
    // does not echo commands back, and a player typing into silence cannot
    // tell a slow world from a dead one.
    append({ kind: "echo", text: `> ${text}` });
    if (socket && socket.readyState === WebSocket.OPEN) {
      send(socket, { type: "CLIENT_MESSAGE", message: text });
    } else {
      append({ kind: "system", text: "Not connected to the world." });
    }
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
        data-status={status}
      >
        {lines.map((line, index) => (
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
          placeholder={
            mode === "exploration"
              ? "Type a command, e.g. look"
              : "Type a command, e.g. north"
          }
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

function send(socket: WebSocket, frame: ClientFrame): void {
  socket.send(JSON.stringify(frame));
}
