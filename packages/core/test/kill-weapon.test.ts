// KillDetail weapon attribution: the killing blow's weapon id rides the
// detail (hitscan weapon, rocket/grenade splash), null for unattributed
// deaths. Record-only: no sim behavior, RNG, or hash changes.
import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function duel(seed = 7): World {
  const world = new World({ seed });
  world.addPlayer({ x: 100, y: floorY() });
  world.addPlayer({ x: 300, y: floorY() });
  return world;
}

describe("kill weapon attribution", () => {
  it("records the SMG id for SMG hitscan kills", () => {
    const world = duel();
    world.players[0].weapon = "smg";
    world.players[0].magAmmo = WEAPONS.smg.mag;
    world.players[1].hp = 5;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("kill");
    const kills = world.drainKillDetails();
    expect(kills).toHaveLength(1);
    expect(kills[0].killerId).toBe(world.players[0].id);
    expect(kills[0].weapon).toBe("smg");
  });

  it("records the pistol id for pistol hitscan kills", () => {
    const world = duel();
    world.players[0].weapon = "pistol";
    world.players[0].magAmmo = WEAPONS.pistol.mag;
    world.players[1].hp = 5;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("kill");
    const kills = world.drainKillDetails();
    expect(kills).toHaveLength(1);
    expect(kills[0].weapon).toBe("pistol");
  });

  it("records grenade for grenade-splash kills", () => {
    const world = new World({ seed: 3 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 130, y });
    const ownerId = world.players[0].id;
    const victimId = world.players[1].id;
    // Toss straight up so the fuse burns out at our feet; splash (165px)
    // catches the adjacent victim at full damage.
    world.step([{ grenade: true, aim: -Math.PI / 2 }, {}]);
    let kill = null;
    for (let i = 0; i < 220 && kill === null; i += 1) {
      const victim = world.players[1];
      if (victim.alive && victim.hp > 1) {
        victim.hp = 1;
      }
      world.step([{}, {}]);
      for (const detail of world.drainKillDetails()) {
        if (detail.victimId === victimId && detail.killerId === ownerId) {
          kill = detail;
        }
      }
    }
    expect(kill).not.toBe(null);
    expect((kill as { weapon: string | null }).weapon).toBe("grenade");
  });

  it("records rocket for rocket-splash kills", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 170, y });
    const ownerId = world.players[0].id;
    const victimId = world.players[1].id;
    world.players[0].weapon = "rocket";
    world.players[0].magAmmo = WEAPONS.rocket.mag;
    world.players[1].hp = 5;
    world.step([{ fire: true, aim: 0 }, {}]);
    let kill = null;
    for (let i = 0; i < 30 && kill === null; i += 1) {
      world.step([{}, {}]);
      for (const detail of world.drainKillDetails()) {
        if (detail.victimId === victimId && detail.killerId === ownerId) {
          kill = detail;
        }
      }
    }
    expect(kill).not.toBe(null);
    expect((kill as { weapon: string | null }).weapon).toBe("rocket");
  });

  it("records null for unattributed sleeper deaths", () => {
    const world = duel();
    world.players[1].hp = 0;
    const events = world.step([{}, {}]);
    expect(events).toContain("kill");
    const kills = world.drainKillDetails();
    expect(kills).toHaveLength(1);
    expect(kills[0].killerId).toBe(null);
    expect(kills[0].weapon).toBe(null);
  });
});
