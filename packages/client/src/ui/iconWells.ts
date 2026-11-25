// Static icon well retrofit (issue #351): the source index.html carries
// icon wells as `<img data-src="./assets/atlas/...">` (no `src`) so the
// Vite HTML bundler never flattens them to `dist/assets/*.png` (which
// would break the zero-PNG gate and the atlas contract). At boot this
// module copies each `data-src` to `src` once, so live DOM carries the
// atlas PNG while the static source stays bundler-invisible. Pure
// helpers stay DOM-free and unit-testable under node; the binder never
// throws on shorn docs.
export const STATIC_ICON_ATTR = "data-src";

/** Copy one well's data-src to src when src is missing or stale. Pure. */
export function retrofitIconSrc(icon: unknown): boolean {
  try {
    const el = icon as {
      getAttribute?(name: string): unknown;
      setAttribute?(name: string, value: string): void;
      src?: unknown;
    };
    let want: string | null = null;
    if (typeof el.getAttribute === "function") {
      const got = (el.getAttribute as (n: string) => unknown).call(el, STATIC_ICON_ATTR);
      if (typeof got === "string" && got !== "") {
        want = got;
      }
    }
    if (want === null) {
      return false;
    }
    let cur: string | null = null;
    if (typeof el.getAttribute === "function") {
      const got = (el.getAttribute as (n: string) => unknown).call(el, "src");
      if (typeof got === "string") {
        cur = got;
      }
    }
    if (cur === null && typeof el.src === "string") {
      cur = el.src as string;
    }
    if (cur === want) {
      return false;
    }
    if (typeof el.setAttribute === "function") {
      (el.setAttribute as (n: string, v: string) => void).call(el, "src", want);
    }
    try {
      (el as Record<string, unknown>)["src"] = want;
    } catch {
      // Attribute above already landed.
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrofit every static `<img data-src>` well in the document: copy
 * data-src to src so live DOM carries the atlas PNG. Returns the count
 * of wells touched. Missing/unsupported docs read 0 and never throw.
 */
export function retrofitStaticIcons(doc: unknown): number {
  try {
    const api = doc as unknown as {
      querySelectorAll?: unknown;
    };
    if (typeof api.querySelectorAll !== "function") {
      return 0;
    }
    const found = (api.querySelectorAll as (sel: string) => unknown).call(
      api,
      `img[${STATIC_ICON_ATTR}]`,
    );
    let list: unknown[] = [];
    if (found !== null && typeof found === "object") {
      if (typeof (found as Iterable<unknown>)[Symbol.iterator] === "function") {
        list = [...(found as Iterable<unknown>)];
      } else if (typeof (found as ArrayLike<unknown>).length === "number") {
        const arr = found as ArrayLike<unknown>;
        for (let i = 0; i < arr.length; i += 1) {
          list.push(arr[i]);
        }
      }
    }
    let touched = 0;
    for (const icon of list) {
      if (retrofitIconSrc(icon)) {
        touched += 1;
      }
    }
    return touched;
  } catch {
    return 0;
  }
}
