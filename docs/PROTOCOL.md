# The NehsaMUD wire protocol

Everything a third-party client needs to connect, play, and script — in any
language. This is the contract; the TypeScript client in `apps/web` is one
implementation of it and has no privileged access.

**Why this document exists.** PRD-0001 OQ1 asked whether scripting should run
client-side or server-side. It is **client-side**: you write your automation in
C#, Python, or whatever you like, connect over this protocol, and drive the
game with the same frames a person's client sends. That means the protocol —
not a package — is the thing that has to be stable and documented.

---

## 1. Connecting

A single **WebSocket**. No subprotocol, no compression requirement, no
handshake beyond the frames below.

```
ws://<host>:22009          # default; MUD_WS_PORT
```

There is also a plain HTTP port (`MUD_HTTP_PORT`, default 22010) serving
`/health`, `/metrics`, `/capabilities` and `/character-options`. None is
needed to play, but the last one is how a picker UI learns what a character
can be built from — see §3.

Every frame in both directions is **one JSON object per WebSocket text
message**, with a `type` field. Unknown fields are ignored; unknown frame
types are ignored rather than fatal, so a newer server can add one without
breaking you.

---

## 2. Authenticating — always first

**The first frame you send MUST be `AUTH`.** Anything else closes the socket
with code **4401** (`auth-required`).

```json
{ "type": "AUTH", "token": "<jwt>" }
```

The token is an HS256 JWT signed with the shared secret, carrying:

| claim | meaning |
|---|---|
| `sub` | the **owner id** — opaque to the engine; the host decides what it means |
| `aud` | must be `hopper-mud` |
| `exp` | expiry, seconds since epoch |

How you get one is the host's business, not the engine's. HopperGuard mints
them at `/api/mud/auth-token` for a signed-in user; the standalone site has a
dev-only minter. **The engine never learns who you are beyond `sub`.**

You then receive exactly one of:

```json
{ "type": "AUTH_OK", "userId": "...", "mode": "pve",
  "capabilities": { "hostiles": true, "combat": true,
                    "playerVersusPlayer": false, "looting": false,
                    "scripting": true } }
```

```json
{ "type": "AUTH_FAILED", "error": "..." }
```

### Read the capabilities. Do not assume them.

`mode` is one of `exploration`, `pve`, `pvp`, and `capabilities` says what the
world permits. **Trust this over any compile-time constant**, including one
copied from this document: a client that renders an attack button against an
Exploration world is showing a control the server will refuse, and Exploration
is the build whose entire promise is that nothing can hurt you.

Treat a **missing or malformed** capability set as *everything false*. Do not
read it field by field — a partially-parsed set is how a client concludes
combat is available because one boolean survived. (HopperGuard's client learned
this the hard way when `monsters` was renamed to `hostiles`: requiring every key
meant the rename degraded safely instead of half-enabling a UI.)

---

## 3. Playing

### Sending a command

```json
{ "type": "CLIENT_MESSAGE", "message": "attack goblin" }
```

The `message` is exactly what a person would type. There is no separate command
API and no verb the protocol exposes that typing cannot reach — that is
deliberate (PRD-0001 R24), and it is why scripting needs no sandbox: **a script
cannot do anything a player could not do by hand.**

### Receiving

```json
{ "type": "SERVER_MESSAGE", "message": "You are in the town square..." }
```

One line per frame. A single command usually produces several. There is **no
end-of-response marker** — the engine does not frame replies as transactions.
Clients should render lines as they arrive; a script that needs to know a
command finished should wait for a short idle period (300–500 ms is what the
reference client uses) rather than counting lines, because the count varies
with what is in the room and how a combat roll landed.

### Creating a character

Two ways. Either send everything at once:

```json
{ "type": "CREATE_CHARACTER", "name": "Aelric",
  "options": { "race": "dwarf", "class": "warrior" } }
```

…or answer the conversational flow, which the server starts by asking for a
name when you authenticate without a character. Both paths run identical
validation.

**`options` is a map of group key → option slug, and the groups are content,
not constants.** A fantasy pack declares `race` and `class`; a care-centre pack
may declare something else, or nothing at all. **Do not hardcode them** — a
client that did drifted to ten races the engine had never heard of.

Ask instead, over plain HTTP, before you open a socket:

```
GET http://<host>:22010/character-options
```

```json
{ "groups": [
    { "key": "race", "name": "Race", "description": "What you are.",
      "required": true,
      "options": [
        { "slug": "dwarf", "name": "Dwarf", "description": "Stout, stubborn…" }
      ] } ] }
```

`groups` may be **empty** — a pack with no creation axes is a valid world, and
that is a 200, not an error. A **503** means the server has no world loaded and
genuinely cannot answer; treat the two differently, or an empty form appears
where an error belongs.

The conversational creation flow asks the same questions one axis at a time,
if you would rather not fetch anything.

---

## 4. Rate limiting — the one thing a script must respect

**The server limits commands per connection, and no client can opt out.**

| | |
|---|---|
| Sustained rate | **5 commands/second** |
| Burst | **20 commands** after an idle period |

Exceeding it does not disconnect you. The command is refused and you get:

```
You are sending commands too quickly. The limit is 5 per second.
Try again in 2 seconds.
```

The retry figure is rounded up and never zero, so a client that obeys it will
always succeed. **Obey it rather than retrying immediately** — a hot retry loop
is the behaviour the limit exists to stop, and refusals do not refill the
bucket any faster.

This is the server-side half of PRD-0001 R21/R22. The engine also ships a
script language with its own instruction budget, but that only governs scripts
*it* runs; a client in another language inherits none of it, which is exactly
why this limit lives here.

---

## 5. The script language (optional)

The engine defines a small language for automation. You are not required to use
it — drive the socket however you like — but it is a reasonable thing to
implement in your own client, and it is what the reference implementation uses.

```
attack goblin              a command, sent verbatim
repeat 5: attack goblin    a fixed number of times
while hp < 50: rest        while a condition about YOU holds
if hp > 80: attack goblin  once, if it holds
stop                       give up early
```

Conditions read `hp`, `maxhp`, `level`, `xp` — your own state, read-only —
compared with `<`, `<=`, `>`, `>=`, `==`, `!=` against a number. There are no
variables, no assignment, no arithmetic, and no way to name anything.

**Evaluate conditions between commands, not once.** `while hp < 50: rest` has
to see the hp that resting produced. A runner that walks the program collecting
commands will either emit nothing or loop forever.

The TypeScript implementation (`parseScript`, `ScriptRunner`) is exported from
`@nehsamud/engine` if you want to read it as a reference.

---

## 6. Closing

Send `quit` as a `CLIENT_MESSAGE`; the server replies with a farewell line and
closes with **1000**. Close codes you may see:

| code | meaning |
|---|---|
| 1000 | normal — you quit |
| 1002 | protocol violation — malformed JSON |
| 4401 | auth required, or auth failed |

---

## 7. What is NOT guaranteed

Stated plainly so nobody builds on it:

- **Message wording.** Player-facing text is content and will change; a pack
  supplies its own. Never parse prose to detect state — use the command whose
  answer you need.
- **Line counts per command.** They vary with the room and with combat rolls.
- **Ordering between your commands and other players' broadcasts.** A `say`
  from someone else can arrive in the middle of your `look` output.

What **is** stable: the frame types, their field names, the capability keys,
and the rule that a command is a line a player could type.
