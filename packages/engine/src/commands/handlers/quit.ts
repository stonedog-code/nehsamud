/**
 * `quit` — graceful disconnect.
 *
 * Returns a farewell line; the ws-server layer is responsible for
 * actually closing the socket once it sees a `quit` verb come
 * back from the dispatcher (the dispatcher itself doesn't have a
 * socket reference).
 */

import type { CommandHandler } from "../types.js";
import { reply } from "../types.js";

export const quitHandler: CommandHandler = () => {
  return reply("Safe travels.");
};
