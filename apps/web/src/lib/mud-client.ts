/**
 * The WebSocket protocol, as the browser speaks it.
 *
 * Kept apart from the React component so the frame handling can be
 * unit-tested without a DOM or a socket. The component owns the connection
 * and the rendering; this owns what the bytes mean.
 *
 * The frame shapes mirror `packages/engine/src/ws-server.ts`. They are
 * duplicated rather than imported because the engine's package root pulls in
 * express, Prisma and OpenTelemetry, none of which belong in a browser
 * bundle — the same reason `deriveCharacter` needed its own subpath. A
 * shared protocol subpath would be the tidier answer if these ever drift.
 */

export interface AuthFrame {
  type: "AUTH";
  token: string;
}

export interface CreateCharacterFrame {
  type: "CREATE_CHARACTER";
  name: string;
  /** groupKey → optionSlug, e.g. { race: "elf", class: "mage" }. The axes
   * are pack data, so the frame carries a map rather than named fields. */
  options: Record<string, string>;
}

export interface ClientMessageFrame {
  type: "CLIENT_MESSAGE";
  message: string;
}

export type ClientFrame =
  | AuthFrame
  | CreateCharacterFrame
  | ClientMessageFrame;

export interface ServerFrame {
  type: string;
  message?: string;
  error?: string;
  userId?: string;
  mode?: string;
  capabilities?: Record<string, boolean>;
}

/** How a line should be rendered, matching the preview world's vocabulary. */
export type LineKind = "room" | "echo" | "system" | "text";

export interface Line {
  kind: LineKind;
  text: string;
}

/**
 * Turn one server frame into the lines it should add to the transcript.
 *
 * Returns an array because a frame can produce none — `AUTH_OK` carries
 * capabilities the UI reads but has nothing a player needs to read.
 */
export function linesForFrame(frame: ServerFrame): Line[] {
  switch (frame.type) {
    case "SERVER_MESSAGE":
      return frame.message ? [{ kind: "text", text: frame.message }] : [];
    case "AUTH_FAILED":
      return [
        {
          kind: "system",
          text: `The world refused the connection: ${frame.error ?? "authentication failed"}`,
        },
      ];
    case "AUTH_OK":
      // Deliberately silent. The player did not ask to authenticate and does
      // not need to be told it worked; the next thing they see is the room.
      return [];
    default:
      // An unrecognised frame is dropped rather than rendered. Printing raw
      // JSON into the transcript is how protocol noise ends up looking like
      // something the game said.
      return [];
  }
}

/** Parse a raw frame, returning null when it is not JSON we understand. */
export function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as ServerFrame;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Where the engine is, for a browser.
 *
 * `NEXT_PUBLIC_MUD_WS_URL` is the switch between the live engine and the
 * in-browser preview. Unset means preview — which keeps a fresh clone
 * playable with no database, and keeps the preview honest about being a
 * preview rather than a silent fallback nobody notices.
 */
export function engineUrl(): string | undefined {
  const url = process.env.NEXT_PUBLIC_MUD_WS_URL;
  return url && url.length > 0 ? url : undefined;
}
