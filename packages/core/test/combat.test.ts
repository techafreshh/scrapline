import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function twoPlayers200(seed = 1): World {
  const world = new World({ seed });
  const y = floorY();
  world.addPlayer({ x: 100, y });
  world.addPlayer({ x: 300, y });
  return world;
}

describe("combat pistol", () => {
  it("pistol deals 20 dmg at 200px and emits shot", () => {
    const world = twoPlayers200();
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(80);
  });

  it("accepts buttons bitmask fire", () => {
    const world = twoPlayers200();
    const events = world.step([{ buttons: 4, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(80);
  });
});

describe("combat regen", () => {
  it("10hp + 360 untouched ticks regens to >= 60", () => {
    const world = new World({});
    world.step();
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected auto-spawned player");
    }
    player.hp = 10;
    for (let t = 0; t < 360; t += 1) {
      world.step({});
    }
    expect(world.players[0]?.hp ?? 0).toBeGreaterThanOrEqual(60);
  });

  it("recent damage delays regen", () => {
    const world = twoPlayers200();
    // Deal one pistol hit (20 dmg) then wait only 60 ticks: still in delay.
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(world.players[1]?.hp).toBe(80);
    for (let t = 0; t < 60; t += 1) {
      world.step([{}, {}]);
    }
    // 60 ticks < 300 delay: no regen yet.
    expect(world.players[1]?.hp ?? 0).toBe(80);
  });
});

describe("combat respawn protection", () => {
  it("dead + 180 ticks => alive at spawn with protection that blocks damage", () => {
    const world = twoPlayers200(3);
    const victim = world.players[1];
    if (victim === undefined) {
      throw new Error("expected victim");
    }
    const spawnX = victim.x;
    const spawnY = victim.y;
    // Kill via 5 pistol hits with cooldown waits.
    for (let k = 0; k < 5; k += 1) {
      world.step([{ fire: true, aim: 0 }, {}]);
      for (let t = 0; t < 14; t += 1) {
        world.step([{}, {}]);
      }
    }
    expect(world.players[1]?.alive).toBe(false);
    for (let t = 0; t < 180; t += 1) {
      world.step([{}, {}]);
    }
    const revived = world.players[1];
    expect(revived?.alive).toBe(true);
    expect(revived?.hp).toBe(100);
    expect(revived?.x).toBe(spawnX);
    expect(revived?.y).toBe(spawnY);
    expect(revived?.protectionTicks ?? 0).toBeGreaterThan(0);
    // Protected hit deals 0.
    const hpBefore = revived?.hp ?? 100;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(hpBefore);
    expect(events).not.toContain("damage");
  });

  it("manual dead with respawnTicks 180 revives after 180", () => {
    const world = new World({});
    world.step();
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.alive = false;
    player.hp = 0;
    player.respawnTicks = 180;
    for (let t = 0; t < 180; t += 1) {
      world.step({});
    }
    expect(world.players[0]?.alive).toBe(true);
    expect(world.players[0]?.protectionTicks ?? 0).toBeGreaterThan(0);
  });
});

describe("combat headshot", () => {
  it("top-band hit deals more than base pistol damage", () => {
    const world = twoPlayers200(11);
    // Aim slightly up so the ray enters the top 15px band.
    const events = world.step([{ fire: true, aim: -0.11 }, {}]);
    expect(events).toContain("shot");
    const hp = world.players[1]?.hp ?? 100;
    // Headshot: 20 * 1.5 = 30 => hp 70 (spread keeps it in band).
    expect(hp).toBeLessThan(80);
    expect(hp).toBe(70);
  });

  it("torso hit deals exact base damage", () => {
    const world = twoPlayers200(11);
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(world.players[1]?.hp).toBe(80);
  });
});

describe("combat wall block", () => {
  it("wall between shooter and victim blocks damage but still emits shot", () => {
    const width = 40;
    const height = 20;
    const rows: string[] = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        if (y >= height - 2) {
          row += "#";
        } else if (x === 7) {
          row += "#";
        } else {
          row += ".";
        }
      }
      rows.push(row);
    }
    const world = new World({ seed: 5, rows });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(100);
    expect(events).not.toContain("damage");
  });
});

describe("combat cooldown and reload", () => {
  it("cooldown blocks an immediate second shot", () => {
    const world = twoPlayers200();
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(world.players[1]?.hp).toBe(80);
    const magAfterFirst = world.players[0]?.magAmmo ?? -1;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).not.toContain("shot");
    expect(world.players[0]?.magAmmo).toBe(magAfterFirst);
    expect(world.players[1]?.hp).toBe(80);
  });

  it("empty mag auto-reloads and refills after reload ticks", () => {
    const world = twoPlayers200();
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    shooter.magAmmo = 1;
    shooter.cooldownTicks = 0;
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(shooter.magAmmo).toBe(0);
    expect(shooter.reloading).toBe(true);
    const reloadTicks = WEAPONS.pistol.reload;
    for (let t = 0; t < reloadTicks; t += 1) {
      world.step([{}, {}]);
    }
    expect(shooter.reloading).toBe(false);
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag);
  });

  it("manual reload refills a partial mag", () => {
    const world = twoPlayers200();
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag - 1);
    for (let t = 0; t < 14; t += 1) {
      world.step([{}, {}]);
    }
    world.step([{ reload: true }, {}]);
    expect(shooter.reloading).toBe(true);
    for (let t = 0; t < WEAPONS.pistol.reload; t += 1) {
      world.step([{}, {}]);
    }
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag);
  });

  it("rocket consumes ammo and emits shot without hitscan damage", () => {
    const world = twoPlayers200();
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    shooter.weapon = "rocket";
    shooter.magAmmo = WEAPONS.rocket.mag;
    shooter.cooldownTicks = 0;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(100);
  });
});

describe("combat hop and land", () => {
  it("emits hop on JET rising edge", () => {
    const world = new World({});
    world.step();
    const events = world.step({ buttons: 1 });
    expect(events).toContain("hop");
  });

  it("emits land when falling back to ground", () => {
    const world = new World({});
    world.step();
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.y -= 120;
    player.vy = 0;
    player.onGround = false;
    let landed = false;
    for (let t = 0; t < 120; t += 1) {
      const events = world.step({});
      if (events.includes("land")) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
  });
});

describe("combat order independence", () => {
  it("protectionTicks=1 blocks damage in both player orders", () => {
    for (const order of ["forward", "reverse"] as const) {
      const world = twoPlayers200(7);
      const shooter = order === "forward" ? 0 : 1;
      const victim = order === "forward" ? 1 : 0;
      const aim = victim === 1 ? 0 : Math.PI;
      const victimPlayer = world.players[victim];
      if (victimPlayer === undefined) {
        throw new Error("expected victim");
      }
      victimPlayer.protectionTicks = 1;
      const inputs: Array<{ fire?: boolean; aim?: number }> = [{}, {}];
      inputs[shooter] = { fire: true, aim };
      const events = world.step(inputs);
      expect(events).toContain("shot");
      expect(world.players[victim]?.hp).toBe(100);
      expect(events).not.toContain("damage");
    }
  });

  it("exact-lethal regen timing is order-independent", () => {
    const outcomes: Array<{ hp: number; alive: boolean }> = [];
    for (const order of ["forward", "reverse"] as const) {
      const world = twoPlayers200(7);
      const shooter = order === "forward" ? 0 : 1;
      const victim = order === "forward" ? 1 : 0;
      const aim = victim === 1 ? 0 : Math.PI;
      const victimPlayer = world.players[victim];
      if (victimPlayer === undefined) {
        throw new Error("expected victim");
      }
      victimPlayer.hp = 20;
      victimPlayer.ticksSinceDamage = 9999;
      const inputs: Array<{ fire?: boolean; aim?: number }> = [{}, {}];
      inputs[shooter] = { fire: true, aim };
      world.step(inputs);
      outcomes.push({
        hp: world.players[victim]?.hp ?? NaN,
        alive: world.players[victim]?.alive ?? false,
      });
    }
    expect(outcomes[1]?.hp).toBe(outcomes[0]?.hp);
    expect(outcomes[1]?.alive).toBe(outcomes[0]?.alive);
  });

  it("hp-only sleeper revives within 180 ticks", () => {
    const world = new World({});
    world.step();
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.hp = 0;
    for (let t = 0; t < 180; t += 1) {
      world.step({});
    }
    expect(world.players[0]?.alive).toBe(true);
    expect(world.players[0]?.protectionTicks ?? 0).toBeGreaterThan(0);
  });
});

describe("combat determinism", () => {
  it("same seed and fire inputs hash-equal", () => {
    const a = twoPlayers200(42);
    const b = twoPlayers200(42);
    for (let t = 0; t < 5; t += 1) {
      a.step([{ fire: t === 0, aim: 0 }, {}]);
      b.step([{ fire: t === 0, aim: 0 }, {}]);
    }
    expect(a.hash()).toBe(b.hash());
  });
});

describe("explosives rocket splash", () => {
  function wallRows(): string[] {
    const width = 40;
    const height = 20;
    const rows: string[] = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        if (y >= height - 2) {
          row += "#";
        } else if (x === 13) {
          row += "#";
        } else {
          row += ".";
        }
      }
      rows.push(row);
    }
    return rows;
  }
  it("rocket fired at wall 300px away splashes victim within 100px for >=50", () => {
    const world = new World({ seed: 1, rows: wallRows() });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 340, y });
    const shooter = world.players[0];
    const victim = world.players[1];
    if (shooter === undefined || victim === undefined) {
      throw new Error("expected players");
    }
    shooter.weapon = "rocket";
    shooter.magAmmo = WEAPONS.rocket.mag;
    shooter.cooldownTicks = 0;
    const first = world.step([{ fire: true, aim: 0 }, {}]);
    expect(first).toContain("shot");
    expect(victim.hp).toBe(100);
    expect(world.projectiles.length).toBe(1);
    expect(world.projectiles[0]?.kind).toBe("rocket");
    let exploded = false;
    let events: string[] = [];
    for (let t = 0; t < 60; t += 1) {
      events = world.step([{}, {}]);
      if (events.includes("explode")) {
        exploded = true;
        break;
      }
    }
    expect(exploded).toBe(true);
    expect(events).toContain("explode");
    expect(100 - (victim.hp ?? 100)).toBeGreaterThanOrEqual(50);
  });
});

describe("explosives grenade fuse", () => {
  it("grenade button consumes 1 of 3 slots and explodes on tick 144", () => {
    const world = twoPlayers200(9);
    const thrower = world.players[0];
    if (thrower === undefined) {
      throw new Error("expected thrower");
    }
    expect(thrower.grenades ?? 3).toBe(3);
    const first = world.step([{ grenade: true, aim: 0 }, {}]);
    expect(thrower.grenades).toBe(2);
    expect(world.projectiles.length).toBe(1);
    expect(world.projectiles[0]?.kind).toBe("grenade");
    expect(world.projectiles[0]?.lifeTicks).toBe(144);
    void first;
    for (let t = 0; t < 143; t += 1) {
      world.step([{}, {}]);
    }
    expect(world.projectiles.length).toBe(1);
    const events = world.step([{}, {}]);
    expect(events).toContain("explode");
    expect(world.projectiles.length).toBe(0);
  });
  it("accepts buttons bitmask 8 for grenade throw", () => {
    const world = twoPlayers200(9);
    world.step([{ buttons: 8, aim: 0 }, {}]);
    expect(world.players[0]?.grenades).toBe(2);
    expect(world.projectiles.length).toBe(1);
  });
});

describe("explosives grenade bounce", () => {
  it("grenade dropped 200px bounces with attenuated post-bounce vy", () => {
    const world = new World({ seed: 4 });
    world.step();
    const floorTop = 18 * 32;
    const dropY = floorTop - 200;
    world.projectiles.push({
      id: 999,
      kind: "grenade",
      x: 200,
      y: dropY,
      vx: 0,
      vy: 0,
      damage: 115,
      ownerId: 0,
      lifeTicks: 1000,
    });
    let sawBounce = false;
    let preMag = 0;
    let postMag = 0;
    for (let t = 0; t < 180; t += 1) {
      const before = world.projectiles[0]?.vy ?? 0;
      const events = world.step({});
      const after = world.projectiles[0]?.vy ?? 0;
      if (events.includes("bounce")) {
        sawBounce = true;
        preMag = Math.abs(before);
        postMag = Math.abs(after);
        break;
      }
    }
    expect(sawBounce).toBe(true);
    expect(postMag).toBeLessThan(preMag);
    expect(postMag).toBeLessThanOrEqual(0.5 * preMag + 1e-9);
  });
});

describe("explosives barrel", () => {
  it("barrel at blast center is destroyed and emits explode", () => {
    const width = 40;
    const height = 20;
    const rows: string[] = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        if (y >= height - 2) {
          row += "#";
        } else if (x === 13) {
          row += "#";
        } else {
          row += ".";
        }
      }
      rows.push(row);
    }
    const world = new World({ seed: 2, rows });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 600, y });
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    shooter.weapon = "rocket";
    shooter.magAmmo = WEAPONS.rocket.mag;
    shooter.cooldownTicks = 0;
    const floorTop = 18 * 32;
    const barrel = world.addProp("barrel", 390, floorTop - 34);
    expect(barrel.alive).toBe(true);
    world.step([{ fire: true, aim: 0 }, {}]);
    let exploded = false;
    let events: string[] = [];
    for (let t = 0; t < 60; t += 1) {
      events = world.step([{}, {}]);
      if (events.includes("explode")) {
        exploded = true;
        break;
      }
    }
    expect(exploded).toBe(true);
    expect(barrel.alive).toBe(false);
    expect(events).toContain("explode");
  });
});

describe("explosives determinism", () => {
  it("same-seed replay with rockets and grenades hash-equals", () => {
    const make = (): World => {
      const world = twoPlayers200(42);
      const shooter = world.players[0];
      if (shooter !== undefined) {
        shooter.weapon = "rocket";
        shooter.magAmmo = WEAPONS.rocket.mag;
      }
      return world;
    };
    const a = make();
    const b = make();
    for (let t = 0; t < 30; t += 1) {
      const fire = t === 0;
      const nade = t === 2;
      a.step([
        { fire, grenade: nade, aim: 0 },
        {},
      ]);
      b.step([
        { fire, grenade: nade, aim: 0 },
        {},
      ]);
    }
    expect(a.hash()).toBe(b.hash());
  });
});
