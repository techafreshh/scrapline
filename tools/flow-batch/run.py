#!/usr/bin/env python3
"""Generate Scrapline UI prompts in Google Flow, export via the CDN.

Why this exists: driving Flow's editor UI is brittle (the agent tab closes, the
session outgrows the snapshot line cap, the export menu lives outside <main>).
Instead this fills the composer by execCommand, clicks its submit button, then
watches the image URLs in the page for new entries and pulls the full-size file
straight from the CDN through a tiny localhost sink.

Run:  python -I run3.py [ID ...]
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

TAB = "flow"
BASE = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.join(BASE, "prompts")
MANIFEST = os.path.join(BASE, "manifest.tsv")
LOG = os.path.join(BASE, "log3.txt")
RESULTS = r"C:\Users\h\Desktop\rl python\skaiscrap\docs\ui-prompts\results"
PROJECT = "https://flow.google.com/project/995dc0a2-d798-4488-a162-1decf2e85923"
PORT = 8731

USED = os.path.join(BASE, "used-srcs.txt")
USED_SET = set()


def load_used():
    if not os.path.exists(USED):
        return set()
    return set(x.strip() for x in open(USED, encoding="utf-8") if x.strip())


def mark_used(src):
    with open(USED, "a", encoding="utf-8") as f:
        f.write(src.split("=")[0] + "\n")


COMPOSER = '[aria-label="What do you want to create?"]'
START = 'button[aria-label="Start generation"]'


def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def browse(args, timeout=180):
    try:
        p = subprocess.run(
            ["browse"] + args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return p.stdout or "", p.stderr or ""
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT"


def ev(expr, timeout=90, world=None):
    obj = {"tab": TAB, "expression": expr, "timeout": timeout * 1000}
    if world:
        obj["world"] = world
    out, _ = browse(["eval", "--json", json.dumps(obj)], timeout=timeout + 20)
    out = out.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except Exception:
        return out


# ---------------------------------------------------------------- local sink
class Sink(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(n)
            name = "incoming.jpg"
            if "?" in self.path:
                q = self.path.split("?", 1)[1]
                for part in q.split("&"):
                    if part.startswith("name="):
                        name = part[5:]
            dest = os.path.join(RESULTS, os.path.basename(name))
            with open(dest, "wb") as f:
                f.write(data)
            log("saved %s (%d bytes)" % (os.path.basename(dest), len(data)))
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        except Exception as e:  # keep the sink alive
            self.send_response(500)
            self._cors()
            self.end_headers()
            self.wfile.write(str(e).encode())

    def log_message(self, *a):
        pass


def start_sink():
    srv = HTTPServer(("127.0.0.1", PORT), Sink)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ------------------------------------------------------------------- browser
def in_editor():
    return bool(ev("() => location.pathname.includes('/edit/')"))


def tab_alive():
    out, _ = browse(["tabs", "list"])
    try:
        return any(t.get("id") == TAB for t in json.loads(out).get("tabs", []))
    except Exception:
        return False


def open_tab():
    browse(
        ["tabs", "--json", json.dumps({"action": "new", "url": PROJECT, "id": TAB, "keepOpen": True})]
    )
    time.sleep(8)


def ensure_page():
    for _ in range(4):
        if not tab_alive():
            log("tab gone: reopening")
            open_tab()
        if ev("() => !!document.querySelector('%s')" % COMPOSER):
            return True
        log("composer missing: reloading")
        browse(["navigate", "--json", json.dumps({"tab": TAB, "url": PROJECT})])
        time.sleep(8)
    return bool(ev("() => !!document.querySelector('%s')" % COMPOSER))


def click_text(needle, selector="button"):
    return ev(
        "() => { const els=[...document.querySelectorAll(%s)];"
        " const b=els.find(x=>(x.getAttribute('aria-label')||x.textContent||'').includes(%s));"
        " if(!b) return 'not-found'; b.click(); return 'ok'; }"
        % (json.dumps(selector), json.dumps(needle))
    )


def settings_text():
    return ev(
        "() => { const b=[...document.querySelectorAll('button')].find(x=>"
        "(x.getAttribute('aria-label')||x.textContent||'').includes('Agent settings'));"
        " return b ? (b.textContent||b.getAttribute('aria-label')||'').trim().slice(0,80) : ''; }"
    )


def set_aspect(aspect):
    ensure_page()
    click_text("Agent settings")
    time.sleep(2)
    click_text("Image defaults")
    time.sleep(2)
    r = ev(
        "() => { const b=[...document.querySelectorAll('button')].find(x=>"
        "(x.textContent||'').includes(%s)); if(!b) return 'no-aspect-btn';"
        " b.click(); return 'ok'; }" % json.dumps(aspect)
    )
    time.sleep(1)
    for _ in range(2):
        ev(
            "() => { const b=[...document.querySelectorAll('button')].find(x=>"
            "(x.getAttribute('aria-label')||'')==='Back'); if(b) b.click(); return !!b; }"
        )
        time.sleep(1.5)
    ok = ensure_page()
    log("aspect -> %s (click=%s, page=%s)" % (aspect, r, ok))
    return ok


# ------------------------------------------------------------------ pipeline
def collect_srcs():
    srcs = ev(
        "() => [...document.images].map(i=>i.currentSrc||i.src)"
        ".filter(s=>s.includes('/asb/')).map(s=>s.split('=')[0])"
    )
    return set(srcs) if isinstance(srcs, list) else set()


def scroll_bottom():
    ev("() => { window.scrollTo(0, document.body.scrollHeight);"
       " document.querySelectorAll('*').forEach(e=>{ if(e.scrollHeight>e.clientHeight+50) e.scrollTop=e.scrollHeight; }); return 'ok'; }")


def post(prompt):
    if not ensure_page():
        return False, "no composer"
    chars = ev(
        "() => { const c=document.querySelector('%s'); if(!c) return 'no-composer';"
        " c.focus(); document.execCommand('selectAll',false,null);"
        " document.execCommand('insertText', false, %s); return c.textContent.length; }"
        % (COMPOSER, json.dumps(prompt))
    )
    if not chars or chars == "no-composer":
        browse(["type", "--json", json.dumps({"tab": TAB, "selector": COMPOSER, "text": prompt})])
    time.sleep(1)
    dis = ev("() => { const b=document.querySelector('%s'); return b ? b.disabled : 'missing'; }" % START)
    if dis is True:
        time.sleep(2)
        dis = ev("() => { const b=document.querySelector('%s'); return b ? b.disabled : 'missing'; }" % START)
    browse(["click", "--json", json.dumps({"tab": TAB, "selector": START})])
    return True, "submitted (chars=%s disabled=%s)" % (chars, dis)


def stop_present():
    return bool(
        ev(
            "() => [...document.querySelectorAll('button')].some(b=>"
            "((b.getAttribute('aria-label')||b.textContent||'').trim()==='Stop'))"
        )
    )


def wait_idle(limit=300):
    waited = 0
    while stop_present() and waited < limit:
        time.sleep(5)
        waited += 5
    return waited


def last_gallery_srcs():
    """URLs of the newest generation's images, taken from the last chat gallery.

    Set-diffing image URLs does not work: the chat virtualises, so old images
    re-enter the DOM on reload and look new, and the newest gallery is the only
    reliable anchor for "this prompt's output"."""
    srcs = ev(
        "() => { const gs=[...document.querySelectorAll('[role=group]')]"
        ".filter(g=>(g.getAttribute('aria-label')||'')==='Media options gallery');"
        " if(!gs.length) return []; const g=gs[gs.length-1];"
        " return [...g.querySelectorAll('img')].map(i=>i.currentSrc||i.src)"
        ".filter(s=>s.includes('/asb/')); }"
    )
    return srcs if isinstance(srcs, list) else []


def all_gallery_srcs():
    """Every image URL in every rendered chat gallery (i.e. everything already
    generated in this session)."""
    srcs = ev(
        "() => { const out=[];"
        " for (const g of document.querySelectorAll('[role=group]')) {"
        "  if ((g.getAttribute('aria-label')||'') !== 'Media options gallery') continue;"
        "  for (const i of g.querySelectorAll('img')) {"
        "   const s = i.currentSrc || i.src; if (s && s.includes('/asb/')) out.push(s); } }"
        " return out; }"
    )
    return srcs if isinstance(srcs, list) else []


def gallery_for(prompt):
    """The gallery belonging to this exact prompt.

    Flow stores the prompt itself in each result image's alt text, so matching
    on that is exact and immune to ordering, virtualisation and reloads."""
    key = prompt[:48]
    srcs = ev(
        "() => { const p = %s;"
        " for (const g of [...document.querySelectorAll('[role=group]')].reverse()) {"
        "  if ((g.getAttribute('aria-label')||'') !== 'Media options gallery') continue;"
        "  const im = g.querySelector('img'); if (!im) continue;"
        "  if (((im.alt||'').slice(0, 48)) === p) {"
        "   return [...g.querySelectorAll('img')].map(x=>x.currentSrc||x.src)"
        "    .filter(s=>s.includes('/asb/')); } }"
        " return []; }" % json.dumps(key)
    )
    return srcs if isinstance(srcs, list) else []


def wait_new(prompt, tries=36):
    """Wait for the Stop button to clear, then for this prompt's gallery."""
    for _ in range(tries):
        time.sleep(5)
        if stop_present():
            continue
        scroll_bottom()
        time.sleep(1)
        if in_editor():
            ev(
                "() => { const b=[...document.querySelectorAll('button')].find(x=>"
                "(x.getAttribute('aria-label')||'').startsWith('Back button to go back'));"
                " if(b) b.click(); return !!b; }"
            )
            time.sleep(3)
            ensure_page()
            continue
        got = gallery_for(prompt)
        if got:
            return got
    return []



CHUNK = 80000


def export_via_cdp(src, dest_name):
    """Pull the image through the DevTools bridge: base64 it in the page, then
    read it back in <=80k character slices (eval results cap at 100k)."""
    url = src.split("=")[0] + "=s1024"
    head = ev(
        "async () => { try { const r = await fetch(%s); if(!r.ok) return 'http '+r.status;"
        " const b = await r.blob(); const ab = await b.arrayBuffer();"
        " const bytes = new Uint8Array(ab); let bin = ''; const CH = 0x8000;"
        " for (let i = 0; i < bytes.length; i += CH) {"
        "   bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); }"
        " window.__scr = btoa(bin); window.__scrLen = window.__scr.length;"
        " return [b.size, window.__scrLen]; } catch(e) { return 'err ' + e; } }" % json.dumps(url),
        timeout=180,
        world="main",
    )
    if not isinstance(head, list) or len(head) != 2:
        return "head failed: %s" % (head,)
    size, blen = head
    parts = []
    i = 0
    while i < blen:
        part = ev("() => window.__scr.slice(%d, %d)" % (i, min(i + CHUNK, blen)), timeout=60, world="main")
        if not isinstance(part, str):
            return "chunk %d failed: %s" % (i, part)
        parts.append(part)
        i += CHUNK
    import base64 as _b64
    try:
        data = _b64.b64decode("".join(parts))
    except Exception as e:
        return "decode failed: %s" % e
    dest = os.path.join(RESULTS, dest_name)
    with open(dest, "wb") as f:
        f.write(data)
    ev("() => { window.__scr = null; return 'cleared'; }", world="main")
    return "saved %s (%d bytes, src %d)" % (dest_name, len(data), size)


def main():
    only = sys.argv[1:] or None
    rows = []
    for line in open(MANIFEST, encoding="utf-8"):
        if not line.strip():
            continue
        pid, aspect = line.rstrip("\n").split("\t")
        if only and pid not in only:
            continue
        if os.path.exists(os.path.join(RESULTS, "%s-v1.jpg" % pid)):
            continue
        pfile = os.path.join(PROMPTS, pid + ".txt")
        if not os.path.exists(pfile):
            continue
        rows.append((pid, aspect, open(pfile, encoding="utf-8").read().strip()))

    rows.sort(key=lambda r: (r[1] != "1:1", r[0]))
    USED_SET.update(load_used())
    digests = {}
    for existing in glob.glob(os.path.join(RESULTS, "*.jpg")):
        digests[hashlib.md5(open(existing, "rb").read()).hexdigest()] = os.path.basename(existing)
    start_sink()
    log("sink on http://127.0.0.1:%d, %d prompts queued" % (PORT, len(rows)))
    if ensure_page():
        wait_idle()
        scroll_bottom()
        seeded = [x.split("=")[0] for x in all_gallery_srcs()]
        USED_SET.update(seeded)
        log("seeded %d existing gallery sources as used" % len(seeded))
    current = None
    for pid, aspect, prompt in rows:
        if aspect != current:
            log("=== aspect %s ===" % aspect)
            set_aspect(aspect)
            current = aspect
        ensure_page()
        wait_idle()
        ok, note = post(prompt)
        log("post %s: %s %s" % (pid, ok, note))
        if not ok:
            continue
        src = None
        for attempt in range(3):
            got = wait_new(prompt)
            if not got:
                log("no images for %s (attempt %d)" % (pid, attempt + 1))
                time.sleep(5)
                continue
            candidate = got[0].split("=")[0]
            res = export_via_cdp(candidate, "%s-v1.jpg" % pid)
            log("fetch %s: %s" % (pid, res))
            dest = os.path.join(RESULTS, "%s-v1.jpg" % pid)
            if not os.path.exists(dest):
                continue
            digest = hashlib.md5(open(dest, "rb").read()).hexdigest()
            if digest in digests:
                log("DUPLICATE %s (same bytes as %s) - retrying" % (pid, digests[digest]))
                os.remove(dest)
                time.sleep(5)
                continue
            digests[digest] = pid
            USED_SET.add(candidate)
            mark_used(candidate)
            src = candidate
            break
        if not src:
            log("gave up on %s this pass" % pid)
    log("=== batch done ===")


if __name__ == "__main__":
    main()
