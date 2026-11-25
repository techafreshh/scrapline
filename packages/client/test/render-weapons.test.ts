// In-hand weapon sprites with manifest muzzle points (issue #264):
// sprite-key distinctness/normalization, on-disk PNG-8 wells, muzzle
// numerics, three-way sync (WEAPON_MUZZLES == WEAPON_DEFS.length ==
// soldierWeaponLength), and the committed manifest muzzle section.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEAPONS, type WeaponId } from "../../core/src/weapons";
import {
  WEAPON_IDS,
  WEAPON_MUZZLES,
  WEAPON_SPRITE_FILES,
  WEAPON_SPRITE_KEYS,
  normalizeWeaponId,
  weaponMuzzle,
  weaponSpriteFile,
  weaponSpriteKey,
} from "../src/render/weapons";
import { soldierWeaponLength } from "../src/render/soldier";
import { WEAPON_DEFS } from "../src/view/soldier";
import {
  isAtlasManifest,
  isWeaponMuzzleOffset,
  manifestMuzzle,
} from "../src/atlas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, "..", "assets");
const MANIFEST_PATH = path.join(ASSETS, "atlas", "manifest.json");

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
}

function svgWidthAttr(body: string): number {
  const match = /width\s*=\s*"([\d.]+)"/.exec(body);
  return match !== null ? Number(match[1]) : NaN;
}

describe("weapon sprite keys", () => {
  it("covers every stat-table weapon id with a distinct key containing its id", () => {
    expect([...WEAPON_IDS].sort()).toEqual(
      (Object.keys(WEAPONS) as WeaponId[]).sort(),
    );
    const keys = WEAPON_IDS.map((id) => weaponSpriteKey(id));
    expect(new Set(keys).size).toBe(WEAPON_IDS.length);
    for (const id of WEAPON_IDS) {
      expect(WEAPON_SPRITE_KEYS[id]).toContain(id);
      expect(weaponSpriteKey(id)).toBe(`weapon.${id}`);
    }
  });

  it("normalizes case, whitespace, and the Hornet alias; unknowns fall back to pistol", () => {
    expect(normalizeWeaponId("RIFLE")).toBe("rifle");
    expect(normalizeWeaponId("  sniper ")).toBe("sniper");
    expect(normalizeWeaponId("hornet")).toBe("smg");
    expect(normalizeWeaponId("Hornet")).toBe("smg");
    expect(normalizeWeaponId("Hornet SMG")).toBe("smg");
    expect(normalizeWeaponId("railgun")).toBe("pistol");
    expect(normalizeWeaponId(null)).toBe("pistol");
    expect(normalizeWeaponId(undefined)).toBe("pistol");
    expect(weaponSpriteKey("Hornet")).toBe("weapon.smg");
    expect(weaponSpriteKey("railgun")).toBe("weapon.pistol");
    expect(weaponSpriteFile("Hornet")).toBe("./assets/atlas/icons/weapon-smg.png");
    expect(weaponSpriteFile("railgun")).toBe("./assets/atlas/icons/weapon-pistol.png");
  });
});

describe("weapon sprite files", () => {
  it("names the SMG card after the Hornet art like the HUD iconFor mapping", () => {
    expect(WEAPON_SPRITE_FILES["smg"]).toBe("./assets/atlas/icons/weapon-smg.png");
    for (const id of WEAPON_IDS) {
      if (id === "smg") {
        continue;
      }
      expect(WEAPON_SPRITE_FILES[id]).toBe(`./assets/atlas/icons/weapon-${id}.png`);
    }
  });

  it("every card exists on disk as a PNG-8 with a distinct pixel box", () => {
    const boxes = new Set<string>();
    for (const id of WEAPON_IDS) {
      const file = WEAPON_SPRITE_FILES[id] as string;
      // Client-root-relative atlas path (./assets/atlas/...) resolves
      // under packages/client/assets/atlas/.
      const rel = file.replace(/^\.\/assets\/atlas\//, "");
      const disk = path.join(ASSETS, "atlas", rel);
      expect(fs.existsSync(disk), `${file} exists on disk`).toBe(true);
      const buf = fs.readFileSync(disk);
      expect(Array.from(buf.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(buf[25]).toBe(3);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      expect(w > 0 && h > 0, `${file} has a pixel box`).toBe(true);
      boxes.add(`${w}x${h}`);
    }
    expect(boxes.size).toBeGreaterThanOrEqual(4);
  });
});

describe("weapon muzzle offsets", () => {
  it("every muzzle is numeric, y is 0, and x stays inside the 10-60 probe band", () => {
    for (const id of WEAPON_IDS) {
      const muzzle = weaponMuzzle(id);
      expect(Number.isFinite(muzzle.x)).toBe(true);
      expect(Number.isFinite(muzzle.y)).toBe(true);
      expect(muzzle.y).toBe(0);
      expect(muzzle.x).toBeGreaterThan(10);
      expect(muzzle.x).toBeLessThan(60);
    }
  });

  it("muzzle copies cannot mutate the table; unknowns fall back to pistol", () => {
    const first = weaponMuzzle("rifle");
    expect(first).toEqual(WEAPON_MUZZLES["rifle"]);
    first.x = 999;
    expect(WEAPON_MUZZLES["rifle"]?.x).toBe(18);
    expect(weaponMuzzle("railgun")).toEqual(WEAPON_MUZZLES["pistol"]);
  });

  it("syncs with WEAPON_DEFS lengths and soldierWeaponLength per id", () => {
    for (const id of WEAPON_IDS) {
      expect(WEAPON_MUZZLES[id]?.x).toBe(WEAPON_DEFS[id].length);
      expect(WEAPON_MUZZLES[id]?.x).toBe(soldierWeaponLength(id));
      expect(WEAPON_MUZZLES[id]?.y).toBe(0);
    }
  });
});

describe("committed manifest muzzle section", () => {
  it("manifest stays a valid atlas manifest with the muzzle entries", () => {
    expect(isAtlasManifest(readManifest())).toBe(true);
  });

  it("all six weapon.<id>.muzzle keys exist with numerics matching the table", () => {
    const manifest = readManifest();
    for (const id of WEAPON_IDS) {
      const name = `weapon.${id}.muzzle`;
      const entry = manifest[name];
      expect(isWeaponMuzzleOffset(entry), `${name} is an {x, y} offset`).toBe(true);
      const muzzle = manifestMuzzle(manifest, name);
      expect(muzzle).toEqual(WEAPON_MUZZLES[id]);
      expect(Number.isFinite(muzzle?.x)).toBe(true);
      expect(Number.isFinite(muzzle?.y)).toBe(true);
    }
  });

  it("manifestMuzzle is null-safe on missing and malformed input", () => {
    const manifest = readManifest();
    expect(manifestMuzzle(manifest, "weapon.railgun.muzzle")).toBeNull();
    expect(manifestMuzzle(manifest, "")).toBeNull();
    expect(manifestMuzzle(manifest, null)).toBeNull();
    expect(manifestMuzzle(null, "weapon.rifle.muzzle")).toBeNull();
    expect(manifestMuzzle({ "weapon.rifle.muzzle": { x: 1 } }, "weapon.rifle.muzzle")).toBeNull();
  });
});
