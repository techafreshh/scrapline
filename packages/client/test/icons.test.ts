// Sliced icon kit contract tests (issue #351): the IC-* PNG-8 wells,
// the full/small weapon split, and the pure icon selectors. Mirrors
// test/chrome.test.ts (small fakes, behavior assertions).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ICON_FILES,
  challengeIconKeyFor,
  challengeIconSrcFor,
  cosmeticIconKeyFor,
  cosmeticIconSrcFor,
  iconBackgroundFor,
  iconFileFor,
  iconSrcFor,
  pickupIconKeyFor,
  pickupIconSrcFor,
  weaponIconKeyFor,
  weaponIconSmallKeyFor,
  weaponIconSmallSrcFor,
  weaponIconSrcFor,
} from "../src/ui/icons";
import { toastIconSrcFor } from "../src/ui/toast";
import { retrofitStaticIcons } from "../src/ui/iconWells";
import { padIconSrcFor } from "../src/ui/padlabels";

const ATLAS_DIR = join(__dirname, "..", "assets", "atlas");
const MANIFEST_PATH = join(ATLAS_DIR, "manifest.json");

function manifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
    string,
    { file: string; atlas: string; w: number; h: number }
  >;
}

/** PNG signature + IHDR color type (3 = PNG-8 palette). */
function pngInfo(buf: Buffer): { w: number; h: number; colorType: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}

describe("icon kit files", () => {
  it("pins every icon key to its committed file", () => {
    const doc = manifest();
    for (const [key, file] of Object.entries(ICON_FILES)) {
      expect(doc[key], `${key} in manifest`).toMatchObject({ file });
      expect(doc[key].atlas).toBe("icons.json");
    }
  });

  it("ships every icon as a PNG-8 with a pixel box", () => {
    for (const file of Object.values(ICON_FILES)) {
      const buf = readFileSync(join(ATLAS_DIR, file));
      const info = pngInfo(buf);
      expect(info.colorType).toBe(3);
      expect(info.w).toBeGreaterThan(0);
      expect(info.h).toBeGreaterThan(0);
    }
  });

  it("weapon small wells are 16x16", () => {
    for (const id of ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"]) {
      const key = `icon.weapon.${id}.small`;
      const file = ICON_FILES[key] as string;
      const buf = readFileSync(join(ATLAS_DIR, file));
      const info = pngInfo(buf);
      expect([info.w, info.h]).toEqual([16, 16]);
    }
  });

  it("no icon file is an SVG", () => {
    for (const file of Object.values(ICON_FILES)) {
      expect(file.endsWith(".svg")).toBe(false);
      expect(file.endsWith(".png")).toBe(true);
    }
  });
});

describe("weapon icon selectors", () => {
  it("maps Hornet readings to the SMG well", () => {
    expect(weaponIconKeyFor("Hornet")).toBe("icon.weapon.smg");
    expect(weaponIconKeyFor("Hornet SMG")).toBe("icon.weapon.smg");
    expect(weaponIconSrcFor("Hornet")).toBe("./assets/atlas/icons/weapon-smg.png");
    expect(weaponIconSmallSrcFor("Hornet")).toBe("./assets/atlas/icons/weapon-smg-small.png");
  });

  it("falls back to pistol wells on unknown readings", () => {
    expect(weaponIconKeyFor("banana")).toBe("icon.weapon.pistol");
    expect(weaponIconSmallKeyFor(null)).toBe("icon.weapon.pistol.small");
    expect(weaponIconSrcFor(undefined)).toBe("./assets/atlas/icons/weapon-pistol.png");
  });

  it("resolves every stat-table id to full + small wells", () => {
    for (const id of ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"]) {
      expect(weaponIconKeyFor(id)).toBe(`icon.weapon.${id}`);
      expect(weaponIconSmallKeyFor(id)).toBe(`icon.weapon.${id}.small`);
      expect(weaponIconSrcFor(id)).toBe(`./assets/atlas/icons/weapon-${id}.png`);
      expect(weaponIconSmallSrcFor(id)).toBe(`./assets/atlas/icons/weapon-${id}-small.png`);
    }
  });
});

describe("pickup/challenge/cosmetic selectors", () => {
  it("maps pad kinds to their IC-02 wells", () => {
    expect(pickupIconKeyFor("health")).toBe("icon.pickup.health");
    expect(pickupIconKeyFor("grenades")).toBe("icon.pickup.grenade");
    expect(pickupIconKeyFor("grenade")).toBe("icon.pickup.grenade");
    expect(pickupIconKeyFor("weapon")).toBe("icon.pickup.ammo");
    expect(pickupIconSrcFor("health")).toBe("./assets/atlas/icons/pickup-health.png");
    expect(pickupIconSrcFor("bogus")).toBe("./assets/atlas/icons/pickup-ammo.png");
  });

  it("maps challenge rows to their IC-04 wells", () => {
    expect(challengeIconKeyFor("rifle-5")).toBe("icon.challenge.headshot");
    expect(challengeIconKeyFor("grenade-2")).toBe("icon.challenge.grenade-arc");
    expect(challengeIconKeyFor("shotgun-3")).toBe("icon.challenge.streak");
    expect(challengeIconKeyFor("win-dune-1")).toBe("icon.challenge.trophy");
    expect(challengeIconKeyFor("win-kilima-1")).toBe("icon.challenge.trophy");
    expect(challengeIconSrcFor("rifle-5")).toBe("./assets/atlas/icons/challenge-headshot.png");
  });

  it("maps locker helmets to their IC-05 wells", () => {
    expect(cosmeticIconKeyFor("cap")).toBe("icon.cosmetic.helmet");
    expect(cosmeticIconKeyFor("hood")).toBe("icon.cosmetic.visor");
    expect(cosmeticIconKeyFor("bandana")).toBe("icon.cosmetic.palette");
    expect(cosmeticIconSrcFor("hood")).toBe("./assets/atlas/icons/cosmetic-visor.png");
  });

  it("toast + pad icons stay null-safe and pickup-only", () => {
    expect(toastIconSrcFor("health")).toBe("./assets/atlas/icons/pickup-health.png");
    expect(toastIconSrcFor("weapon")).toBe("./assets/atlas/icons/pickup-ammo.png");
    expect(toastIconSrcFor(null)).toBeNull();
    expect(toastIconSrcFor("Controller connected")).toBeNull();
    expect(padIconSrcFor("health", null)).toBe("./assets/atlas/icons/pickup-health.png");
    expect(padIconSrcFor("weapon", "rifle")).toBe("./assets/atlas/icons/weapon-rifle-small.png");
  });

  it("retrofits static data-src wells without throwing on shorn docs", () => {
    const fakeDoc = {
      querySelectorAll: (sel: string) => {
        expect(sel).toBe("img[data-src]");
        return [] as unknown[];
      },
    };
    expect(retrofitStaticIcons(fakeDoc)).toBe(0);
    expect(retrofitStaticIcons(null)).toBe(0);
  });

  it("unknown icon keys read null", () => {
    expect(iconFileFor("icon.nope")).toBeNull();
    expect(iconSrcFor(null)).toBeNull();
    expect(iconBackgroundFor("banana")).toBeNull();
  });
});
