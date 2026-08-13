/**
 * End-to-end coverage of the AUTH-first WS gate. Boots a real
 * WebSocket server on an ephemeral port, opens client sockets via
 * the `ws` library, and verifies the close-code / frame contract
 * apps/web depends on.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import WebSocket from "ws";

import { MudWsServer } from "../ws-server.js";

const SECRET = "ws-test-secret";
const AUDIENCE = "hopper-mud";

function makeToken(userId = "u-1"): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, aud: AUDIENCE, iat: now, exp: now + 60 },
    SECRET,
    { algorithm: "HS256" },
  );
}

interface BootedServer {
  url: string;
  server: MudWsServer;
  close(): Promise<void>;
}

async function boot(): Promise<BootedServer> {
  const http = createServer();
  const ws = new MudWsServer({ server: http });
  await new Promise<void>((resolve, reject) => {
    http.listen(0, "127.0.0.1", () => resolve());
    http.on("error", reject);
  });
  const addr = http.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    server: ws,
    close: async () => {
      await ws.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

function nextFrame(sock: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    sock.once("message", (raw) => resolve(raw.toString()));
    sock.once("error", reject);
  });
}

function nextClose(sock: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    sock.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
}

describe("MudWsServer — AUTH-first gate", () => {
  let booted: BootedServer;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    booted = await boot();
  });
  afterEach(async () => {
    await booted.close();
    delete process.env.JWT_SECRET;
  });

  it("closes with 4401 when the first frame is not an AUTH frame", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "hi" }));
    const closed = await nextClose(client);
    expect(closed.code).toBe(4401);
    expect(closed.reason).toBe("auth-required");
  });

  it("accepts a valid AUTH frame and responds with AUTH_OK", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: makeToken("u-42") }));
    const reply = JSON.parse(await nextFrame(client)) as {
      type: string;
      userId: string;
    };
    expect(reply.type).toBe("AUTH_OK");
    expect(reply.userId).toBe("u-42");
    expect(booted.server.summary().authenticated).toBe(1);
    client.close();
  });

  it("falls through with a transport-only notice when no world is loaded", async () => {
    // Default boot() builds a server with no `world` option, so
    // the post-auth dispatch lands in the "(server is in
    // transport-only mode)" branch. This is the contract Phase 1's
    // test-only callers depend on.
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: makeToken() }));
    await nextFrame(client); // AUTH_OK
    client.send(JSON.stringify({ type: "CLIENT_MESSAGE", message: "look" }));
    const reply = JSON.parse(await nextFrame(client)) as {
      type: string;
      message: string;
    };
    expect(reply.type).toBe("SERVER_MESSAGE");
    expect(reply.message).toContain("transport-only");
    client.close();
  });

  it("closes with 4401 when the AUTH token is invalid", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ type: "AUTH", token: "garbage" }));
    const reply = JSON.parse(await nextFrame(client)) as {
      type: string;
      error: string;
    };
    expect(reply.type).toBe("AUTH_FAILED");
    const closed = await nextClose(client);
    expect(closed.code).toBe(4401);
  });

  it("closes with 1002 on malformed JSON", async () => {
    const client = new WebSocket(booted.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send("not json");
    const closed = await nextClose(client);
    expect(closed.code).toBe(1002);
  });
});
