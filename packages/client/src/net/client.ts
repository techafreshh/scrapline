// Honest-mode transport client: JSON-text online play over the existing
// WS framing. DOM-free (no document/window imports at module scope): the
// socket factory and clock are injectable so node probes drive the whole
// session with a fake socket and a fake clock. Sends quantized inputs at
// 60 Hz, ingests snapshots into the interpolation buffer, never predicts.

import {
  INTERP_DELAY_MS,
  SnapshotBuffer,
  poseFromFlags,
  type BufferPlayer,
  type InterpPlayer,
} from "./interpolation";
import { mergeRoster, normalizeRosterName, rosterFrom, type RosterEntry } from "./roster";
import type { OnlineKillEvent, OnlineLeaveEvent } from "./render";

/** Re-exported delay constant for probe convenience. */
export { INTERP_DELAY_MS };

/** Fixed input send rate in Hz (setInterval cadence, rAF-independent). */
export const ONLINE_SEND_HZ = 60;
/** Protocol version carried by the hello frame. */
export const ONLINE_PROTO = 1;
/** Default room path on the same-origin server (`ws://host/room`). */
export const ONLINE_PATH = "/room";

/** Minimal socket surface the client drives (real WebSocket compatible). */
export interface OnlineSocket {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data?: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  /** 1 while the transport accepts sends (fake sockets set it directly). */
  readyState?: number;
}

/** Factory turning a URL into a connected-async socket. */
export type SocketFactory = (url: string) => OnlineSocket;

/** Quantized per-tick intent sampled for every input send. */
export interface OnlineInput {
  moveX: number;
  aim: number;
  buttons: number;
}

/** Options for one OnlineClient (everything injectable for probes). */
export interface OnlineClientOptions {
  /** Explicit URL; defaults to the same-origin /room endpoint. */
  url?: string;
  /** Arena view name carried by the hello frame. */
  view?: string;
  /** Display name carried by the hello frame (server roster nametag). */
  name?: string;
  /**
   * Host-backfill flag carried by the hello frame: true keeps a
   * disconnected slot idling as a bot (false drops its roster name).
   * Omitted when undefined so rooms keep their current setting.
   */
  backfill?: boolean;
  /** Socket factory; defaults to the global WebSocket. */
  createSocket?: SocketFactory;
  /** Millisecond clock; defaults to Date.now. */
  now?: () => number;
  /** Input send rate in Hz (60 keeps the >=50/s floor). */
  sendHz?: number;
  /** Per-send intent sampler (wired to localInput/toInput in main.ts). */
  sampleInput?: () => OnlineInput;
}

/** True while the value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build a room URL for a host and path: `ws://host/room` (or `wss://`
 * when the page itself loaded over TLS). The path defaults to /room so
 * `onlineUrlFor("example.com")` reads `ws://example.com/room`.
 */
export function onlineUrlFor(host: string, path: string = "room"): string {
  const cleanHost = String(host ?? "").trim() || "localhost";
  const cleanPath = String(path ?? "").trim();
  const suffix = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
  let scheme = "ws";
  try {
    const loc = (globalThis as unknown as { location?: { protocol?: unknown } })
      .location;
    if (typeof loc?.protocol === "string" && loc.protocol === "https:") {
      scheme = "wss";
    }
  } catch {
    // No location surface (node probe): plain ws stands.
  }
  return `${scheme}://${cleanHost}${suffix}`;
}

/**
 * Same-origin room URL from the live page (`ws://host/room`, `wss:` under
 * TLS); falls back to ws://localhost/room outside a page harness.
 */
export function defaultOnlineUrl(): string {
  try {
    const loc = (globalThis as unknown as { location?: unknown }).location as
      | { host?: unknown; protocol?: unknown }
      | undefined;
    if (
      loc !== undefined &&
      loc !== null &&
      typeof loc.host === "string" &&
      loc.host.length > 0
    ) {
      return onlineUrlFor(loc.host, ONLINE_PATH);
    }
  } catch {
    // No location surface (node probe): the localhost fallback stands.
  }
  return "ws://localhost/room";
}

/** Default socket factory over the global WebSocket (null outside DOM). */
function defaultSocketFactory(): SocketFactory {
  const Ws = (globalThis as unknown as { WebSocket?: unknown }).WebSocket as
    | (new (url: string) => OnlineSocket)
    | undefined;
  if (typeof Ws === "function") {
    return (url: string) => new Ws(url);
  }
  return () => {
    throw new Error("scrapline: no WebSocket surface and no socket factory");
  };
}

/** Neutral intent: players with no fresh input stand still, aim forward. */
function neutralInput(): OnlineInput {
  return { moveX: 0, aim: 0, buttons: 0 };
}

/**
 * DOM-free honest-mode client. connect() hellos, the open handler stores
 * the welcome session/pid and starts the setInterval input loop, snapshot
 * frames land in the delay buffer, and sample() renders ~100 ms delayed
 * rows for the online draw path. poll() is public so fake-clock probes
 * drive cadence without real timers.
 */
export class OnlineClient {
  /** Snapshots ingested this session (probe counter). */
  snapshotsReceived = 0;
  /** Input frames sent this session (probe counter). */
  inputsSent = 0;
  /** True between welcome and close. */
  connected = false;

  private readonly buffer = new SnapshotBuffer();
  private readonly createSocket: SocketFactory;
  private readonly now: () => number;
  private readonly sendHz: number;
  private readonly sampleInput: () => OnlineInput;
  private readonly url: string;
  private view: string;
  /** Trimmed hello display name (empty omits the field; server falls back). */
  private readonly helloName: string;
  /** Hello backfill flag (undefined omits the field). */
  private readonly helloBackfill: boolean | undefined;
  /** Server roster rows (welcome/snapshot/join drive it; never wiped by flag-less snapshots). */
  private roster: RosterEntry[] = [];
  /** Kills by player id, zipped from the parallel scores/players arrays. */
  private scoreById = new Map<number, number>();
  /** Kill rows drained from snapshot events (renderOnlineSnapshot consumes them). */
  private pendingKills: OnlineKillEvent[] = [];
  /** Departures queued from leave frames (bannered within the frame). */
  private pendingLeaves: OnlineLeaveEvent[] = [];

  private socket: OnlineSocket | null = null;
  private interval: unknown = null;
  private session: string | null = null;
  private pid: number | null = null;
  private tick = 0;
  private lastSendMs = 0;
  private opened = false;

  constructor(options: OnlineClientOptions = {}) {
    this.createSocket = options.createSocket ?? defaultSocketFactory();
    this.now = options.now ?? Date.now;
    const hz = Math.floor(options.sendHz ?? ONLINE_SEND_HZ);
    this.sendHz = Number.isFinite(hz) && hz > 0 ? hz : ONLINE_SEND_HZ;
    this.sampleInput = options.sampleInput ?? neutralInput;
    this.url = options.url ?? defaultOnlineUrl();
    this.view = options.view ?? "dune";
    this.helloName =
      typeof options.name === "string" ? options.name.trim().slice(0, 16) : "";
    this.helloBackfill =
      typeof options.backfill === "boolean" ? options.backfill : undefined;
  }

  /** Session minted by the welcome frame (null before connect). */
  get sessionId(): string | null {
    return this.session;
  }

  /** Player id minted by the welcome frame (null before connect). */
  get playerId(): number | null {
    return this.pid;
  }

  /** Interpolated rows at the delayed render time (empty pre-snapshot). */
  sample(nowMs?: number): InterpPlayer[] {
    const now = nowMs ?? this.now();
    return this.buffer.sample(Number.isFinite(now) ? now : 0);
  }

  /** Fixed interpolation delay in ms (always INTERP_DELAY_MS). */
  interpDelayMs(): number {
    return INTERP_DELAY_MS;
  }

  /** Server roster copy (welcome/snapshot/join drive it). */
  rosterList(): RosterEntry[] {
    return this.roster.map((row) => ({ ...row }));
  }

  /** Kills for a player id (missing rows read 0). */
  scoreFor(id: number): number {
    return this.scoreById.get(id) ?? 0;
  }

  /** Id/score pairs in pid order (drives the online HUD scoreboard). */
  scoresList(): Array<{ id: number; score: number }> {
    return [...this.scoreById.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Zip the parallel scores/players arrays into scoreById: scores[k]
   * owns players[k]. Non-array payloads keep the previous scores so a
   * score-less frame never wipes the board mid-match.
   */
  private ingestScores(players: unknown, scores: unknown): void {
    if (!Array.isArray(players) || !Array.isArray(scores)) {
      return;
    }
    for (let k = 0; k < players.length; k += 1) {
      const item = players[k];
      if (item === null || typeof item !== "object") {
        continue;
      }
      const id = (item as Record<string, unknown>)["id"];
      if (typeof id !== "number" || !Number.isFinite(id)) {
        continue;
      }
      const raw = scores[k];
      this.scoreById.set(
        Math.floor(id),
        typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0,
      );
    }
  }

  /** Display name for a player id (roster wins, else `Player<id>`). */
  nameFor(id: number): string {
    for (const row of this.roster) {
      if (row.id === id && row.name.length > 0) {
        return row.name;
      }
    }
    return `Player${id}`;
  }

  /** Drain queued snapshot kill rows (renderOnlineSnapshot consumes them). */
  drainKills(): OnlineKillEvent[] {
    return this.pendingKills.splice(0);
  }

  /** Drain queued leave banners (renderOnlineSnapshot consumes them). */
  drainLeaves(): OnlineLeaveEvent[] {
    return this.pendingLeaves.splice(0);
  }

  /**
   * Open the socket and hello the room. The hello frame goes out on
   * open (or immediately when the socket reports OPEN already, which
   * keeps fake sockets synchronous). Safe to call once; later calls
   * are no-ops while a socket lives.
   */
  connect(view?: string): void {
    if (this.socket !== null) {
      return;
    }
    if (typeof view === "string" && view.trim().length > 0) {
      this.view = view.trim();
    }
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.opened = true;
      this.sendHello();
    };
    socket.onmessage = (ev: { data?: unknown }) => {
      this.handleData(ev?.data);
    };
    socket.onclose = () => {
      this.connected = false;
      this.opened = false;
    };
    socket.onerror = () => {
      // Transport faults surface through onclose; never throw here.
    };
    try {
      const ready = (socket as { readyState?: unknown }).readyState;
      if (ready === 1 && !this.opened) {
        this.opened = true;
        this.sendHello();
      }
    } catch {
      // readyState unreadable: the onopen path still hellos.
    }
  }

  /**
   * One input-loop step: sends a single `{t:"input",...}` frame when the
   * send quantum (1000/sendHz) elapsed since the last send. The live
   * interval calls this; fake-clock probes call it directly after
   * advancing their clock.
   */
  poll(): void {
    if (!this.connected || this.session === null) {
      return;
    }
    let now: number;
    try {
      now = this.now();
    } catch {
      now = 0;
    }
    if (!Number.isFinite(now)) {
      now = 0;
    }
    const quantum = 1000 / this.sendHz;
    if (now - this.lastSendMs < quantum) {
      return;
    }
    this.lastSendMs = now;
    this.sendInput();
  }

  /** Tear down the loop and the socket (menu restore entry point). */
  close(): void {
    try {
      if (this.interval !== null && typeof clearInterval === "function") {
        clearInterval(this.interval as Parameters<typeof clearInterval>[0]);
      }
    } catch {
      // Timer teardown best-effort only.
    }
    this.interval = null;
    this.connected = false;
    this.session = null;
    this.pid = null;
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      } catch {
        // Half-dead sockets never block teardown.
      }
    }
  }

  /** Send the hello frame over the open socket (best-effort). */
  private sendHello(): void {
    const hello: Record<string, unknown> = {
      t: "hello",
      proto: ONLINE_PROTO,
      view: this.view,
    };
    // Roster identity: the hello name drives every remote nametag, so
    // Alice's client renders Bob (and vice versa), never a bot pool.
    if (this.helloName.length > 0) {
      hello["name"] = this.helloName;
    }
    if (this.helloBackfill !== undefined) {
      hello["backfill"] = this.helloBackfill;
    }
    this.sendJson(hello);
  }

  /** Send one input frame with the locally counted tick. */
  private sendInput(): void {
    let intent: OnlineInput;
    try {
      intent = this.sampleInput();
    } catch {
      intent = neutralInput();
    }
    const rec = (intent ?? {}) as Partial<OnlineInput>;
    const moveX = isFiniteNumber(rec.moveX) ? rec.moveX : 0;
    const aim = isFiniteNumber(rec.aim) ? rec.aim : 0;
    const rawButtons = isFiniteNumber(rec.buttons) ? Math.floor(rec.buttons) : 0;
    this.sendJson({
      t: "input",
      session: this.session,
      tick: this.tick,
      moveX,
      aim,
      buttons: rawButtons & 0x3ff,
    });
    this.tick += 1;
    this.inputsSent += 1;
  }

  /** Best-effort JSON send (half-dead sockets never throw into the loop). */
  private sendJson(value: unknown): void {
    if (this.socket === null) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(value));
    } catch {
      // Send faults surface through onclose; the loop keeps its cadence.
    }
  }

  /** Route one inbound payload: welcome arms the loop, snapshots buffer. */
  private handleData(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      return;
    }
    const rec = msg as Record<string, unknown>;
    // Roster join: upsert the newcomer so nametags appear before the
    // next 20 Hz snapshot reconciles the full roster.
    if (rec["t"] === "join") {
      const id = rec["id"];
      if (typeof id === "number" && Number.isFinite(id)) {
        const pid = Math.floor(id);
        const name = normalizeRosterName(rec["name"], `Player${pid}`);
        const at = this.roster.findIndex((row) => row.id === pid);
        if (at >= 0) {
          this.roster[at] = { id: pid, name };
        } else {
          this.roster.push({ id: pid, name });
        }
      }
      return;
    }
    // Leave banner: queue immediately (the frame banner lands well
    // inside the 1s budget); the roster itself reconciles on the next
    // snapshot so a backfill bot keeps its name.
    if (rec["t"] === "leave") {
      const id = rec["id"];
      const pid =
        typeof id === "number" && Number.isFinite(id) ? Math.floor(id) : -1;
      if (pid >= 0) {
        const name =
          typeof rec["name"] === "string" && rec["name"].length > 0
            ? rec["name"]
            : this.nameFor(pid);
        this.pendingLeaves.push({ id: pid, name });
        if (this.pendingLeaves.length > 8) {
          this.pendingLeaves.splice(0, this.pendingLeaves.length - 8);
        }
      }
      return;
    }
    if (rec["t"] === "welcome") {
      if (typeof rec["session"] === "string") {
        this.session = rec["session"];
      }
      if (typeof rec["pid"] === "number" && Number.isFinite(rec["pid"])) {
        this.pid = Math.floor(rec["pid"]);
      }
      // Server roster: welcome carries every name (including ours), so
      // remote nametags resolve from the first frame.
      const fresh = rosterFrom(rec["roster"]);
      if (fresh.length > 0) {
        this.roster = fresh;
      }
      // Authoritative kills ride the welcome alongside the roster so the
      // online HUD scoreboard lists every pid from the first frame.
      this.ingestScores(rec["players"], rec["scores"]);
      if (this.session !== null) {
        this.connected = true;
        try {
          this.lastSendMs = this.now();
        } catch {
          this.lastSendMs = 0;
        }
        this.startLoop();
      }
      return;
    }
    if (rec["t"] === "snapshot") {
      const players = rec["players"];
      if (!Array.isArray(players)) {
        return;
      }
      const rows: BufferPlayer[] = [];
      for (const item of players) {
        if (item === null || typeof item !== "object") {
          continue;
        }
        const p = item as Record<string, unknown>;
        const id = p["id"];
        if (typeof id !== "number" || !Number.isFinite(id)) {
          continue;
        }
        // Pose + identity ride into the buffer: flags decode to the
        // soldier pose (crouch/jet/dead), the roster name drives the
        // nametag, and fuel bands the exhaust flicker.
        const pose = poseFromFlags(p["flags"]);
        rows.push({
          id: Math.floor(id),
          x: isFiniteNumber(p["x"]) ? p["x"] : 0,
          y: isFiniteNumber(p["y"]) ? p["y"] : 0,
          aim: isFiniteNumber(p["aim"]) ? p["aim"] : 0,
          hp: isFiniteNumber(p["hp"]) ? p["hp"] : 100,
          fuel: isFiniteNumber(p["fuel"]) ? (p["fuel"] as number) : 100,
          weapon: typeof p["weapon"] === "string" ? p["weapon"] : "pistol",
          name:
            typeof p["name"] === "string" && (p["name"] as string).length > 0
              ? (p["name"] as string)
              : undefined,
          alive: typeof p["alive"] === "boolean" ? (p["alive"] as boolean) : pose.alive,
          onGround:
            typeof p["onGround"] === "boolean" ? (p["onGround"] as boolean) : pose.onGround,
          crouching:
            typeof p["crouching"] === "boolean"
              ? (p["crouching"] as boolean)
              : pose.crouching,
          jetting:
            typeof p["jetting"] === "boolean" ? (p["jetting"] as boolean) : pose.jetting,
          protected:
            typeof p["protected"] === "boolean"
              ? (p["protected"] as boolean)
              : pose.protected,
        });
      }
      // Authoritative roster + kill events ride every snapshot: the
      // roster reconciles join/leave churn at 20 Hz and kills queue for
      // the identical offline `Killer ▸ Victim` feed line.
      const freshRoster = rosterFrom(rec["roster"]);
      if (freshRoster.length > 0) {
        this.roster = mergeRoster(this.roster, freshRoster);
      }
      // Authoritative kills ride every snapshot: the online scoreboard
      // reconciles at 20 Hz so the third row in a 3+ player room is
      // never dropped by a stale top-2 snapshot.
      this.ingestScores(rec["players"], rec["scores"]);
      const events = rec["events"];
      if (Array.isArray(events)) {
        for (const item of events) {
          if (item === null || typeof item !== "object") {
            continue;
          }
          const e = item as Record<string, unknown>;
          if (e["kind"] !== "kill") {
            continue;
          }
          const victim = e["victim"];
          if (typeof victim !== "number" || !Number.isFinite(victim)) {
            continue;
          }
          const killer = e["killer"];
          this.pendingKills.push({
            killer:
              typeof killer === "number" && Number.isFinite(killer)
                ? Math.floor(killer)
                : null,
            victim: Math.floor(victim),
            killerName:
              typeof e["killerName"] === "string" && (e["killerName"] as string).length > 0
                ? (e["killerName"] as string)
                : null,
            victimName:
              typeof e["victimName"] === "string" && (e["victimName"] as string).length > 0
                ? (e["victimName"] as string)
                : `Player${Math.floor(victim)}`,
            weapon: typeof e["weapon"] === "string" ? (e["weapon"] as string) : null,
          });
        }
        if (this.pendingKills.length > 25) {
          this.pendingKills.splice(0, this.pendingKills.length - 25);
        }
      }
      let at: number;
      try {
        at = this.now();
      } catch {
        at = 0;
      }
      const tickRaw = rec["tick"];
      const tick =
        typeof tickRaw === "number" && Number.isFinite(tickRaw)
          ? Math.floor(tickRaw)
          : this.buffer.latestTick + 1;
      this.buffer.push(tick, Number.isFinite(at) ? at : 0, rows);
      this.snapshotsReceived += 1;
    }
  }

  /** Start the setInterval input loop (idempotent across welcomes). */
  private startLoop(): void {
    if (this.interval !== null) {
      return;
    }
    try {
      const schedule = (
        globalThis as unknown as { setInterval?: typeof setInterval }
      ).setInterval;
      if (typeof schedule !== "function") {
        return;
      }
      const quantum = 1000 / this.sendHz;
      this.interval = schedule.call(globalThis, () => {
        try {
          this.poll();
        } catch {
          // Sampler faults never kill the loop; the next tick retries.
        }
      }, quantum);
      try {
        const timer = this.interval as { unref?: () => void };
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      } catch {
        // Browser timers lack unref: harmless.
      }
    } catch {
      this.interval = null;
    }
  }
}
