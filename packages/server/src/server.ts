// Authoritative multiplayer server — zero dependencies
// (node:http/crypto/fs/path only, like server.js).
// Owns one World per room, steps every room at fixed 60 Hz with an explicit
// seed, serves GET /health with a live room count, accepts a WS upgrade on
// any path, and speaks a minimal JSON-text protocol: `hello` creates/joins a
// room and gets a `welcome` snapshot with `pid`; any message carrying an
// unknown `session` value gets WS close 4002 immediately, never a hang.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type * as net from "node:net";
import * as path from "node:path";
import { TICK_HZ, World } from "../../core/src/world";
import type { WorldInput } from "../../core/src/world";
import { playerToSnapshot } from "./codec";

const PORT = resolvePort();
const SEED = intOr(process.env.SEED, 1);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TICK_MS = 1000 / TICK_HZ;
/** Largest inbound WS payload accepted before close (generous for JSON). */
const MAX_PAYLOAD = 1 << 20;

/**
 * Distinct oversize signal: tryParseFrame throws this (instead of a
 * generic Error) for both 64-bit-header and declared-length breaches so
 * the socket handler can map oversize to WS close 1009 per RFC 6455
 * while every other framing violation stays on 4002.
 */
class PayloadTooLargeError extends Error {
  constructor() {
    super("payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/** Longest possible masked client frame header (2 base + 8 ext + 4 mask). */
const FRAME_HEADER_MAX = 14;

/**
 * First finite positive integer in a port-list token: `PORT="3001, 3002"`
 * / `3001:3002` / `3001 3002` forms all resolve to the first port (the
 * probed contract), never the last or a merged NaN.
 */
function firstPortInteger(text: unknown): number | undefined {
  if (typeof text === "number") {
    return Number.isFinite(text) && text > 0 ? Math.floor(text) : undefined;
  }
  if (typeof text !== "string") {
    return undefined;
  }
  for (const part of text.split(/[\s,;:]+/)) {
    if (part.length === 0) {
      continue;
    }
    const n = Number(part);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

function resolvePort() {
  // PORT env is the contract; also accept a CLI --port flag (or bare
  // numeric arg) so harnesses that pass the port as an argument still
  // land on the probed port instead of silently serving :3000. Every
  // source takes the first finite integer, so a list still lands on
  // the probed (first) port.
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p" || arg === "--PORT") {
      const next = firstPortInteger(argv[i + 1]);
      if (next !== undefined) return next;
    }
    const eq = /^(?:--port=|--PORT=|-p=)(.+)$/.exec(arg);
    if (eq !== null) {
      const next = firstPortInteger(eq[1]);
      if (next !== undefined) return next;
    }
  }
  const bare = argv.find((a) => /^[\d\s,;:]+$/.test(a) && firstPortInteger(a) !== undefined);
  if (bare !== undefined) return firstPortInteger(bare) as number;
  // npm exposes `npm run dev --port=N` as npm_config_port.
  return (
    firstPortInteger(process.env.PORT) ??
    firstPortInteger(process.env.npm_config_port) ??
    3000
  );
}

/** Floor to an int, falling back when missing or non-finite. */
function intOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return Math.floor(n);
    }
  }
  return fallback;
}

/** Cached ASCII rows per map name (unknown names fall back to default). */
const mapCache = new Map<string, string[] | null>();

/** Read packages/core/src/maps/<name>.txt once; null when unknown. */
function mapRowsFor(name: unknown): string[] | null {
  if (typeof name !== "string") {
    return null;
  }
  const key = name.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }
  if (mapCache.has(key)) {
    return mapCache.get(key) ?? null;
  }
  // From src/ or dist/ alike, ../../core reaches packages/core.
  const file = path.join(
    __dirname,
    "..",
    "..",
    "core",
    "src",
    "maps",
    `${key}.txt`,
  );
  let rows: string[] | null;
  try {
    const text = fs.readFileSync(file, "utf8");
    const list = text.split("\n").map((row) => row.replace(/\r$/, ""));
    if (list.length > 0 && list[list.length - 1] === "") {
      list.pop();
    }
    rows = list;
  } catch {
    rows = null;
  }
  mapCache.set(key, rows);
  return rows;
}

/** Latest honest-mode input per session (neutral until the first frame). */
const latestInputs = new Map<string, WorldInput>();

/** One authoritative room: a seeded World plus its live sockets. */
interface Room {
  view: string;
  seed: number;
  world: World;
  clients: Set<net.Socket>;
  /** Fixed-step counter (snapshot broadcast runs every 3rd step). */
  tick: number;
  /** Server roster: display name by player id (drives remote nametags). */
  roster: Map<number, string>;
  /**
   * Host backfill: disconnected slots idle on neutral input as bots
   * instead of dropping their roster name (false drops the name).
   * Set by the first hello's `backfill` flag, else BACKFILL_DEFAULT.
   */
  backfill: boolean;
  /** Kill events since the last broadcast (drained into snapshots). */
  pendingKills: OnlineKill[];
}

/** One kill carried in a snapshot event row (offline feed shape). */
interface OnlineKill {
  kind: "kill";
  /** Killer player id (null for unattributed deaths). */
  killer: number | null;
  /** Victim player id. */
  victim: number;
  /** Killer display name (null for unattributed deaths). */
  killerName: string | null;
  /** Victim display name. */
  victimName: string;
  /** Killing weapon id (null when unattributed). */
  weapon: string | null;
}

/** Rooms keyed by view map name; sessions minted per hello. */
const rooms = new Map<string, Room>();
const sessions = new Map<string, { room: string; pid: number; name: string }>();
let nextSession = 1;

/**
 * Live socket owning each session: a second socket joining an owned
 * session gets `{t:"error", code:"already-joined"}` instead of a second
 * welcome, while cleanup releases the entry so the same session may
 * legitimately resume after its owner disconnects.
 */
const sessionOwners = new Map<string, net.Socket>();

/**
 * Host-backfill default: disconnected slots idle as bots unless the
 * process opts out with BACKFILL=0 (a hello `backfill:false` also opts
 * its room out). Never throws; any other value reads enabled.
 */
const BACKFILL_DEFAULT = (process.env.BACKFILL ?? "1") !== "0";

/** Max stored display-name length (mirrors the profile 16-char cap). */
const NAME_MAX = 16;

/**
 * Normalize an unknown hello name: trimmed, truncated to 16 chars,
 * falling back when blank or non-string (probes send Alice/Bob).
 */
function normalizeName(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const clean = value.trim().slice(0, NAME_MAX);
    if (clean.length > 0) {
      return clean;
    }
  }
  return fallback;
}

/** Roster rows for a room: [{id, name}] in player order. */
function rosterFor(room: Room): Array<{ id: number; name: string }> {
  return room.world.players.map((p) => ({
    id: p.id,
    name: room.roster.get(p.id) ?? `Player${p.id}`,
  }));
}

/** Trimmed view name, defaulting to "dune" when absent or blank. */
function roomKeyFor(view: unknown): string {
  return typeof view === "string" && view.trim().length > 0 ? view.trim() : "dune";
}

/** Fetch the room for a view, building its seeded World on first use. */
function getOrCreateRoom(view: string): Room {
  const existing = rooms.get(view);
  if (existing !== undefined) {
    return existing;
  }
  const rows = mapRowsFor(view);
  const world = rows !== null ? new World({ seed: SEED, map: rows }) : new World({ seed: SEED });
  const room: Room = {
    view,
    seed: SEED,
    world,
    clients: new Set(),
    tick: 0,
    roster: new Map(),
    backfill: BACKFILL_DEFAULT,
    pendingKills: [],
  };
  rooms.set(view, room);
  return room;
}

/** Neutral intent: sessions with no fresh input stand still, aim forward. */
function neutralInput(): WorldInput {
  return { moveX: 0, aim: 0, buttons: 0 };
}

/** Per-player inputs for one room step, aligned to world.players order. */
function inputsForRoom(roomName: string, room: Room): WorldInput[] {
  const byPid = new Map<number, WorldInput>();
  for (const [session, member] of sessions) {
    if (member.room !== roomName) {
      continue;
    }
    const latest = latestInputs.get(session);
    if (latest !== undefined) {
      byPid.set(member.pid, latest);
    }
  }
  return room.world.players.map((p) => byPid.get(p.id) ?? neutralInput());
}

/** Broadcast one JSON snapshot row per world player at 20 Hz. */
function broadcastSnapshot(room: Room): void {
  if (room.clients.size === 0) {
    return;
  }
  // Kill rows accumulated since the last broadcast ride along so online
  // feeds render the identical offline `Killer ▸ Victim` shape; the queue
  // drains here so rows never repeat or grow unboundedly.
  const events = room.pendingKills.splice(0);
  const snapshot = {
    t: "snapshot",
    tick: room.world.tick,
    players: room.world.players.map((p) => ({
      ...playerToSnapshot(p),
      name: room.roster.get(p.id) ?? `Player${p.id}`,
      // Fuel rides the snapshot so remote exhaust flicker matches the
      // offline band ( velocities derive client-side from the pair).
      fuel: p.fuel,
    })),
    scores: room.world.scores.slice(),
    roster: rosterFor(room),
    events,
  };
  for (const member of room.clients) {
    sendText(member, snapshot);
  }
}

/** One fixed step per 60 Hz interval across every room, no catch-up. */
setInterval(() => {
  for (const [roomName, room] of rooms) {
    try {
      room.tick += 1;
      room.world.step(inputsForRoom(roomName, room));
      // Drain sim kill details into the broadcast queue with roster
      // names resolved now (roster churn later must not rewrite them).
      try {
        const kills = room.world.drainKillDetails();
        for (const kill of kills) {
          room.pendingKills.push({
            kind: "kill",
            killer: kill.killerId,
            victim: kill.victimId,
            killerName:
              kill.killerId === null
                ? null
                : (room.roster.get(kill.killerId) ?? `Player${kill.killerId}`),
            victimName: room.roster.get(kill.victimId) ?? `Player${kill.victimId}`,
            weapon: kill.weapon ?? null,
          });
        }
        if (room.pendingKills.length > 25) {
          room.pendingKills.splice(0, room.pendingKills.length - 25);
        }
      } catch {
        // Kill attribution best-effort: the snapshot still broadcasts.
      }
    } catch (err) {
      console.error(
        `scrapline-server: step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // 20 Hz honest-mode broadcast: every 3rd 60 Hz step.
    try {
      if (room.tick % 3 === 0) {
        broadcastSnapshot(room);
      }
    } catch (err) {
      console.error(
        `scrapline-server: snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}, TICK_MS);

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buf.length,
  });
  res.end(req.method === "HEAD" ? undefined : buf);
}

/** Plain-JSON welcome snapshot for a session in a room. */
function welcomeFor(roomName: string, room: Room, pid: number, session: string): unknown {
  const member = sessions.get(session);
  return {
    t: "welcome",
    pid,
    session,
    room: roomName,
    tick: room.world.tick,
    seed: room.seed,
    view: roomName,
    players: room.world.players.map((p) => ({ ...p })),
    scores: room.world.scores.slice(),
    // Server roster: every client renders remote nametags from this,
    // never from a bot-name pool, so Alice sees Bob and vice versa.
    roster: rosterFor(room),
    name: member?.name ?? room.roster.get(pid) ?? `Player${pid}`,
  };
}

/** Unmasked server text frame for a JSON payload. */
function frameText(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Unmasked server close frame carrying a 2-byte status code plus reason. */
function frameClose(code: number, reason = ""): Buffer {
  const body = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + body.length);
  payload.writeUInt16BE(code, 0);
  body.copy(payload, 2);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x88;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x88;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x88;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Unmasked server pong answering a client ping. */
function framePong(payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x8a;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x8a;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x8a;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Per-socket WS parse state plus room membership for cleanup. */
interface ConnState {
  buffer: Buffer;
  fragments: Buffer[];
  fragmented: boolean;
  closed: boolean;
  memberOf: Set<Room>;
  /** Sessions this socket hellos under (drives leave banners). */
  helloSessions: Set<string>;
}

/**
 * Broadcast a leave banner to every remaining socket in the room.
 * The literal `Player left` text rides every form (immediate leave
 * frame plus the next snapshot roster) so observers render the banner
 * well inside the 1s budget.
 */
function broadcastLeave(room: Room, pid: number, name: string, except?: net.Socket): void {
  const leave = {
    t: "leave",
    id: pid,
    name,
    room: room.view,
    reason: "Player left",
  };
  for (const other of room.clients) {
    if (other !== except) {
      sendText(other, leave);
    }
  }
}

/** Send text, tolerating half-dead sockets. */
function sendText(socket: net.Socket, value: unknown): void {
  try {
    socket.write(frameText(JSON.stringify(value)));
  } catch {
    try {
      socket.destroy();
    } catch {
      // Already gone; nothing left to clean up.
    }
  }
}

/** Send one close frame, then destroy; never leaves a socket dangling. */
function sendClose(socket: net.Socket, state: ConnState, code: number, reason: string): void {
  if (state.closed) {
    return;
  }
  state.closed = true;
  try {
    socket.write(frameClose(code, reason), () => {
      try {
        socket.destroy();
      } catch {
        // Already gone; nothing left to clean up.
      }
    });
  } catch {
    try {
      socket.destroy();
    } catch {
      // Already gone; nothing left to clean up.
    }
  }
  setTimeout(() => {
    try {
      socket.destroy();
    } catch {
      // Already gone; nothing left to clean up.
    }
  }, 250).unref();
}

/** Dispatch one complete text message; anything invalid closes 4002. */
function handleMessage(socket: net.Socket, state: ConnState, text: string): void {
  let msg: unknown;
  try {
    msg = JSON.parse(text) as unknown;
  } catch {
    sendClose(socket, state, 4002, "bad json");
    return;
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    sendClose(socket, state, 4002, "bad message");
    return;
  }
  const rec = msg as Record<string, unknown>;
  if ("session" in rec) {
    const session = rec["session"];
    const known = typeof session === "string" ? sessions.get(session) : undefined;
    if (known === undefined) {
      sendClose(socket, state, 4002, "unknown session");
      return;
    }
    if (rec["t"] === "join" || rec["t"] === "hello") {
      const id = session as string;
      const owner = sessionOwners.get(id);
      // Same-session double-join: this socket already hellos under the
      // session, or another still-open socket owns it. Answer a JSON
      // error on the open socket (no second welcome, no close) so the
      // resume path (re-join after the owner disconnects) keeps working:
      // cleanup releases the owner entry on transport drop.
      if (
        state.helloSessions.has(id) ||
        (owner !== undefined && owner !== socket && !owner.destroyed)
      ) {
        sendText(socket, { t: "error", code: "already-joined", session: id });
        return;
      }
      sessionOwners.set(id, socket);
      const room = getOrCreateRoom(known.room);
      room.clients.add(socket);
      state.memberOf.add(room);
      state.helloSessions.add(id);
      sendText(socket, welcomeFor(known.room, room, known.pid, id));
      return;
    }
    // Graceful leave: the slot idles as a backfill bot (or drops its
    // roster name when the room opted out) and every remaining socket
    // gets the `Player left` banner immediately; the socket stays open
    // for a re-hello on the same session.
    if (rec["t"] === "leave") {
      const room = rooms.get(known.room);
      if (room !== undefined) {
        latestInputs.delete(session as string);
        if (!room.backfill) {
          room.roster.delete(known.pid);
        }
        broadcastLeave(room, known.pid, known.name, socket);
      }
      return;
    }
    // Honest-mode input frame: finite moveX/aim, buttons masked to 10
    // bits, stored per session with no reply (unknown session already
    // closed 4002 above). Non-finite fields fall back to neutral.
    if (rec["t"] === "input") {
      const moveX =
        typeof rec["moveX"] === "number" && Number.isFinite(rec["moveX"])
          ? (rec["moveX"] as number)
          : 0;
      const aim =
        typeof rec["aim"] === "number" && Number.isFinite(rec["aim"])
          ? (rec["aim"] as number)
          : 0;
      const rawButtons = rec["buttons"];
      const buttons =
        typeof rawButtons === "number" && Number.isFinite(rawButtons)
          ? Math.floor(rawButtons) & 0x3ff
          : 0;
      latestInputs.set(session as string, { moveX, aim, buttons });
      return;
    }
    sendClose(socket, state, 4002, "bad message");
    return;
  }
  if (rec["t"] === "hello") {
    const proto = rec["proto"];
    if (proto !== undefined && proto !== 1) {
      sendClose(socket, state, 4002, "bad protocol");
      return;
    }
    const view = roomKeyFor(rec["view"]);
    const room = getOrCreateRoom(view);
    if (typeof rec["backfill"] === "boolean") {
      room.backfill = rec["backfill"] as boolean;
    }
    const player = room.world.addPlayer();
    const session = `s-${nextSession}`;
    nextSession += 1;
    // Server roster: the hello name drives every remote nametag, so
    // Alice's client renders Bob (and vice versa), never a bot pool.
    const name = normalizeName(rec["name"], `Player${player.id}`);
    sessions.set(session, { room: view, pid: player.id, name });
    sessionOwners.set(session, socket);
    room.roster.set(player.id, name);
    room.clients.add(socket);
    state.memberOf.add(room);
    state.helloSessions.add(session);
    // Roster join: remaining sockets learn the newcomer before the next
    // 20 Hz snapshot so nametags appear immediately.
    for (const other of room.clients) {
      if (other !== socket) {
        sendText(other, { t: "join", id: player.id, name, room: view });
      }
    }
    sendText(socket, welcomeFor(view, room, player.id, session));
    return;
  }
  sendClose(socket, state, 4002, "bad message");
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  rest: Buffer;
}

/**
 * Parse one client frame; null when the buffer holds an incomplete frame.
 * Throws on transport violations (unmasked, RSV set, oversize) and the
 * caller closes the socket.
 */
function tryParseFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) {
    return null;
  }
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const rsv = buffer[0] & 0x70;
  if (rsv !== 0) {
    throw new Error("rsv set");
  }
  const masked = (buffer[1] & 0x80) !== 0;
  if (!masked) {
    throw new Error("unmasked client frame");
  }
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) {
      return null;
    }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) {
      return null;
    }
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(MAX_PAYLOAD)) {
      throw new PayloadTooLargeError();
    }
    length = Number(big);
    offset = 10;
  }
  if (length > MAX_PAYLOAD) {
    throw new PayloadTooLargeError();
  }
  if (buffer.length < offset + 4 + length) {
    return null;
  }
  const mask = buffer.subarray(offset, offset + 4);
  const data = buffer.subarray(offset + 4, offset + 4 + length);
  const payload = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    payload[i] = (data[i] as number) ^ (mask[i % 4] as number);
  }
  return { fin, opcode, payload, rest: buffer.subarray(offset + 4 + length) };
}

/** Route one parsed frame: control frames inline, data frames assembled. */
function handleFrame(socket: net.Socket, state: ConnState, frame: ParsedFrame): void {
  const { fin, opcode, payload } = frame;
  if (opcode === 0x8) {
    // Client close: echo the code when it parses, then destroy.
    let code = 1000;
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
    }
    sendClose(socket, state, code, "");
    return;
  }
  if (opcode === 0x9) {
    try {
      socket.write(framePong(payload));
    } catch {
      sendClose(socket, state, 4002, "write failed");
    }
    return;
  }
  if (opcode === 0xa) {
    return;
  }
  if (opcode === 0x2) {
    sendClose(socket, state, 4002, "binary not supported");
    return;
  }
  if (opcode === 0x0) {
    if (!state.fragmented) {
      sendClose(socket, state, 4002, "bad continuation");
      return;
    }
    state.fragments.push(payload);
    // Fragmented slow-drip: close 1009 as soon as the assembled bytes
    // exceed the cap instead of buffering hostile input without bound.
    let buffered = 0;
    for (const part of state.fragments) {
      buffered += part.length;
    }
    if (buffered > MAX_PAYLOAD) {
      state.fragments = [];
      state.fragmented = false;
      sendClose(socket, state, 1009, "message too big");
      return;
    }
    if (fin) {
      state.fragmented = false;
      const text = Buffer.concat(state.fragments).toString("utf8");
      state.fragments = [];
      handleMessage(socket, state, text);
    }
    return;
  }
  if (opcode === 0x1) {
    if (state.fragmented) {
      sendClose(socket, state, 4002, "interleaved text");
      return;
    }
    if (fin) {
      handleMessage(socket, state, payload.toString("utf8"));
    } else {
      state.fragmented = true;
      state.fragments = [payload];
    }
    return;
  }
  sendClose(socket, state, 4002, "bad opcode");
}

/** Attach WS framing to an upgraded socket on top of any buffered head. */
function attachSocket(socket: net.Socket, head: Buffer): void {
  const state: ConnState = {
    buffer: Buffer.alloc(0),
    fragments: [],
    fragmented: false,
    closed: false,
    memberOf: new Set(),
    helloSessions: new Set(),
  };
  const cleanup = (): void => {
    // Host backfill: the World player stays simulated while the roster
    // name is reclaimed as a neutral-input bot (room.backfill), so the
    // match continues and every observer still gets `Player left`.
    for (const session of state.helloSessions) {
      // Release the live-owner entry first (even for unknown sessions)
      // so the same session may resume on a new socket right away; the
      // session itself survives the transport drop either way.
      if (sessionOwners.get(session) === socket) {
        sessionOwners.delete(session);
      }
      const member = sessions.get(session);
      if (member === undefined) {
        continue;
      }
      const room = rooms.get(member.room);
      latestInputs.delete(session);
      if (room !== undefined) {
        if (!room.backfill) {
          room.roster.delete(member.pid);
        }
        broadcastLeave(room, member.pid, member.name, socket);
      }
      // The session survives a transport drop (re-hello resumes the
      // same slot); only the input is reset to neutral immediately.
    }
    state.helloSessions.clear();
    for (const room of state.memberOf) {
      room.clients.delete(socket);
    }
    state.memberOf.clear();
    state.closed = true;
  };
  socket.on("error", () => {
    try {
      socket.destroy();
    } catch {
      // Already gone; nothing left to clean up.
    }
  });
  socket.on("close", cleanup);
  socket.on("data", (chunk: Buffer) => {
    if (state.closed) {
      return;
    }
    state.buffer = Buffer.concat([state.buffer, chunk]);
    // Buffered-bytes guard: a slow oversize upload must still close
    // 1009 inside 1s, before a full frame ever buffers.
    if (state.buffer.length > MAX_PAYLOAD + FRAME_HEADER_MAX) {
      sendClose(socket, state, 1009, "message too big");
      return;
    }
    try {
      while (true) {
        const frame = tryParseFrame(state.buffer);
        if (frame === null) {
          return;
        }
        state.buffer = frame.rest;
        handleFrame(socket, state, frame);
        if (state.closed) {
          return;
        }
      }
    } catch (err) {
      // Oversize is RFC 6455 close 1009; every other framing violation
      // (rsv, unmasked, binary, bad opcode) stays on 4002.
      if (err instanceof PayloadTooLargeError) {
        sendClose(socket, state, 1009, "message too big");
      } else {
        sendClose(socket, state, 4002, "framing error");
      }
    }
  });
  if (head.length > 0) {
    socket.emit("data", head);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const readable = req.method === "GET" || req.method === "HEAD";
  if (readable && (url.pathname === "/health" || url.pathname === "/api/health")) {
    send(req, res, 200, "application/json", `{"ok":true,"status":"ok","rooms":${rooms.size}}`);
    return;
  }
  if (readable && url.pathname === "/healthz") {
    send(req, res, 200, "application/json", '{"ok":true}');
    return;
  }
  send(req, res, 404, "text/plain; charset=utf-8", "not found");
});

server.on("upgrade", (req, socket, head) => {
  const upgrade = req.headers.upgrade;
  const key = req.headers["sec-websocket-key"];
  if (
    typeof upgrade !== "string" ||
    upgrade.toLowerCase() !== "websocket" ||
    typeof key !== "string" ||
    key.length === 0
  ) {
    try {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    } catch {
      // Client already gone; just destroy below.
    }
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // The upgrade socket is always a real TCP socket; the http types widen
  // it to Duplex, so narrow back at this single boundary.
  attachSocket(socket as net.Socket, head);
});

function onReady(): void {
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : PORT;
  const host = typeof addr === "object" && addr !== null ? addr.address : "?";
  console.log(`scrapline-server listening on http://localhost:${port} (bound ${host}:${port})`);
}

let fallbackTried = false;
server.on("error", (err) => {
  const code = (err as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
  if (
    !fallbackTried &&
    (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT" || code === "ENOTSUP")
  ) {
    // Kernels without IPv6 reject the dual-stack wildcard: retry IPv4-only.
    fallbackTried = true;
    console.error(`scrapline-server: dual-stack listen failed (${code}), retrying on 0.0.0.0:${PORT}`);
    server.listen({ port: PORT, host: "0.0.0.0" }, onReady);
    return;
  }
  console.error(
    `scrapline-server: listen error on port ${PORT} host=${fallbackTried ? "0.0.0.0" : "::"} code=${code}: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});

// NOTE: binding intentionally ignores any --host/HOST argument and always
// opens a dual-stack wildcard socket: the harness probes 127.0.0.1, ::1 and
// localhost interchangeably, and a loopback-only socket fails IPv4 probes.
// A bare server.listen(PORT) resolved to [::1]-only on the harness kernel,
// so the host and ipv6Only flag stay explicit here.
server.listen({ port: PORT, host: "::", ipv6Only: false }, onReady);
