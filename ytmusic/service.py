"""Lunaris v2 music service.

A tiny JSON API (127.0.0.1 only) on top of ytmusicapi (https://github.com/sigma67/ytmusicapi).
server.js starts this script and the browser talks to it through /api/music/*.

ytmusicapi supplies the catalog: charts, home shelves, search, albums, playlists, artists and radio.
It does not supply audio, so the site plays each song by its videoId through the official YouTube player.

Run by hand for testing:  python ytmusic/service.py --port 3031
"""

import argparse
import json
import os
import queue
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import metadata
from urllib.parse import parse_qs, urlparse

from ytmusicapi import YTMusic

COUNTRY = os.environ.get("YTMUSIC_COUNTRY", "US")
POOL_SIZE = 8
FEED_SIZE = 700
ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,80}$")


# ---- a small pool of ytmusicapi clients (one request at a time per client) ----
_pool = queue.Queue()
_made = 0
_made_lock = threading.Lock()


@contextmanager
def client():
    global _made
    try:
        c = _pool.get_nowait()
    except queue.Empty:
        with _made_lock:
            make = _made < POOL_SIZE
            if make:
                _made += 1
        c = YTMusic(location=COUNTRY) if make else _pool.get(timeout=30)
    try:
        yield c
    finally:
        _pool.put(c)


# ---- shaping ytmusicapi's output into the small objects the page uses ----
def names(artists):
    return ", ".join(a["name"] for a in (artists or []) if isinstance(a, dict) and a.get("name"))


def first_id(artists):
    for a in artists or []:
        if isinstance(a, dict) and a.get("id"):
            return a["id"]
    return ""


def thumb(thumbs, size=400):
    """Largest thumbnail, re-requested at a good size when it is a resizable Google image."""
    if not thumbs:
        return ""
    url = thumbs[-1].get("url", "") if isinstance(thumbs[-1], dict) else ""
    if "googleusercontent.com" in url or "ggpht.com" in url:
        url = re.sub(r"=w\d+-h\d+", "=w%d-h%d" % (size, size), url, count=1)
    return url


def seconds(value):
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"(\d+:){1,2}\d+", value):
        total = 0
        for part in value.split(":"):
            total = total * 60 + int(part)
        return total
    return 0


def song(t, fallback_thumb=""):
    if not isinstance(t, dict) or not t.get("videoId") or t.get("isAvailable") is False:
        return None
    al = t.get("album")
    artists = t.get("artists") or []
    dur = t.get("duration_seconds") or seconds(t.get("length") or t.get("duration"))
    return {
        "t": "s",
        "id": t["videoId"],
        "n": t.get("title") or "Untitled",
        "a": names(artists) or t.get("author") or "Unknown artist",
        "ai": first_id(artists),
        # every credited artist, so each name can link to its own page
        "ar": [{"n": a["name"], "id": a.get("id") or ""} for a in artists if isinstance(a, dict) and a.get("name")][:6],
        "al": (al.get("name") if isinstance(al, dict) else al) or "",
        "c": (al.get("id") if isinstance(al, dict) else "") or "",
        "i": thumb(t.get("thumbnails") or t.get("thumbnail")) or fallback_thumb,
        "d": int(dur) * 1000,
        "e": 1 if t.get("isExplicit") else 0,
    }


def card(it):
    """Any shelf entry (song, album, playlist or artist) as a typed card; None for things the site can't open."""
    if not isinstance(it, dict):
        return None
    if it.get("videoId"):
        return song(it)
    bid = it.get("browseId") or ""
    pid = it.get("playlistId") or ""
    title = it.get("title") or it.get("artist") or ""
    if not title or it.get("podcastId") or bid.startswith(("MPSP", "MPED")):
        return None
    img = thumb(it.get("thumbnails"))
    if bid.startswith("MPREb"):
        sub = names(it.get("artists")) or it.get("subscribers") or it.get("type") or "Album"
        return {"t": "a", "id": bid, "n": title, "a": sub, "y": it.get("year") or "", "i": img}
    if bid.startswith("UC"):
        subs = it.get("subscribers")
        return {"t": "r", "id": bid, "n": title, "a": (subs + " subscribers") if subs else "Artist", "i": img}
    pid = pid or (bid[2:] if bid.startswith("VL") else "")
    if pid:
        author = it.get("author")
        if isinstance(author, dict):
            author = author.get("name")
        if isinstance(author, list):
            author = names(author)
        sub = author or (it.get("description") or "")[:70] or "Playlist"
        return {"t": "p", "id": pid, "n": title, "a": sub, "i": img}
    return None


def cards(items, limit=40):
    out = [c for c in (card(x) for x in items or []) if c]
    return out[:limit]


def songs(tracks, fallback_thumb=""):
    return [s for s in (song(t, fallback_thumb) for t in tracks or []) if s]


# ---- endpoints ----
def search(q):
    if not q:
        return {"songs": [], "albums": [], "artists": [], "playlists": []}

    def run(filter_, limit):
        last = None
        for _ in range(2):  # one retry: YouTube occasionally answers a single request badly
            try:
                with client() as c:
                    return c.search(q, filter=filter_, limit=limit, ignore_spelling=True)
            except Exception as e:
                last = e
        raise last

    with ThreadPoolExecutor(4) as ex:
        jobs = [ex.submit(run, "songs", 30), ex.submit(run, "albums", 10), ex.submit(run, "artists", 8), ex.submit(run, "playlists", 10)]
    res = []
    failed = 0
    for f in jobs:
        try:
            res.append(f.result())
        except Exception as e:
            failed += 1
            print("search failed:", e, file=sys.stderr)
            res.append([])
    if failed == len(jobs):  # say so, instead of looking like "no results"
        raise RuntimeError("search failed")
    s, al, ar, pl = res
    artists = []
    for a in ar:
        if a.get("browseId"):
            artists.append({"t": "r", "id": a["browseId"], "n": a.get("artist") or a.get("title") or "", "a": "Artist", "i": thumb(a.get("thumbnails"))})
    return {"songs": songs(s), "albums": cards(al, 10), "artists": artists, "playlists": cards(pl, 10)}


def album(browse_id):
    with client() as c:
        a = c.get_album(browse_id)
    cover = thumb(a.get("thumbnails"))
    return {
        "info": {"id": browse_id, "n": a.get("title") or "Album", "a": names(a.get("artists")), "ai": first_id(a.get("artists")), "y": a.get("year") or "", "i": cover},
        "tracks": songs(a.get("tracks"), cover),
    }


def playlist(playlist_id):
    pid = playlist_id[2:] if playlist_id.startswith("VL") else playlist_id
    with client() as c:
        p = c.get_playlist(pid, limit=100)
    cover = thumb(p.get("thumbnails"))
    author = p.get("author")
    if isinstance(author, dict):
        author = author.get("name")
    if isinstance(author, list):
        author = names(author)
    return {"info": {"id": pid, "n": p.get("title") or "Playlist", "a": author or "", "i": cover}, "tracks": songs(p.get("tracks"), cover)}


def artist(channel_id):
    with client() as c:
        a = c.get_artist(channel_id)
    section = lambda key: (a.get(key) or {}).get("results") or []
    top = songs(section("songs"))
    full_id = (a.get("songs") or {}).get("browseId") or ""
    if full_id:  # the page only lists a few songs; "see all" is a playlist with the full list
        try:
            with client() as c:
                p = c.get_playlist(full_id[2:] if full_id.startswith("VL") else full_id, limit=100)
            full = songs(p.get("tracks"))
            if len(full) > len(top):
                top = full
        except Exception as e:
            print("artist songs failed:", e, file=sys.stderr)
    return {
        "info": {"id": channel_id, "n": a.get("name") or "Artist", "i": thumb(a.get("thumbnails"), 600), "s": a.get("subscribers") or "", "m": a.get("monthlyListeners") or ""},
        "songs": top,
        "albums": cards(section("albums"), 30),
        "singles": cards(section("singles"), 30),
        "related": cards(section("related"), 14),
    }


def feed():
    """One long list of songs for the front page: the home shelves' songs, then a mix of chart, genre and mood playlists."""
    def home():
        with client() as c:
            return c.get_home(limit=8)

    def charts():
        with client() as c:
            return c.get_charts(COUNTRY)

    with ThreadPoolExecutor(2) as ex:
        fh, fc = ex.submit(home), ex.submit(charts)

    def got(f):
        try:
            return f.result()
        except Exception as e:
            print("feed:", e, file=sys.stderr)
            return None

    h, ch = got(fh) or [], got(fc) or {}
    quick, pids = [], []
    for it in ch.get("videos") or []:
        if it.get("playlistId") and "Live Performances" not in (it.get("title") or ""):
            pids.append(it["playlistId"])
    for shelf in h:
        n = 0
        for it in shelf.get("contents") or []:
            if it.get("videoId"):
                s = song(it)
                if s:
                    quick.append(s)
            elif it.get("playlistId") and n < 3:
                pids.append(it["playlistId"])
                n += 1
    for it in ch.get("genres") or []:
        if it.get("playlistId"):
            pids.append(it["playlistId"])
    pids = list(dict.fromkeys(pids))[:26]

    def tracks(pid):
        try:
            with client() as c:
                p = c.get_playlist(pid, limit=100)
            return songs(p.get("tracks"), thumb(p.get("thumbnails")))
        except Exception as e:
            print("feed playlist failed:", e, file=sys.stderr)
            return []

    with ThreadPoolExecutor(POOL_SIZE) as ex:
        lists = list(ex.map(tracks, pids))
    out, seen = [], set()

    def add(s):
        if s["id"] not in seen:
            seen.add(s["id"])
            out.append(s)

    for s in quick:
        add(s)
    for i in range(max((len(x) for x in lists), default=0)):  # take turns between playlists so the list stays varied
        for x in lists:
            if i < len(x):
                add(x[i])
        if len(out) >= FEED_SIZE:
            break
    if not out:
        raise RuntimeError("YouTube Music returned no songs")
    return {"songs": out[:FEED_SIZE]}


def radio(video_id):
    with client() as c:
        w = c.get_watch_playlist(videoId=video_id, limit=30)
    tracks = songs(w.get("tracks"))
    return {"tracks": [t for t in tracks if t["id"] != video_id]}


def need_id(q, key="id"):
    v = (q.get(key) or [""])[0]
    if not ID_RE.match(v):
        raise ValueError("bad id")
    return v


ROUTES = {
    "/feed": lambda q: feed(),
    "/search": lambda q: search((q.get("q") or [""])[0].strip()[:80]),
    "/album": lambda q: album(need_id(q)),
    "/playlist": lambda q: playlist(need_id(q)),
    "/artist": lambda q: artist(need_id(q)),
    "/radio": lambda q: radio(need_id(q)),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "Lunaris v2-music"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/health":
            try:
                ver = metadata.version("ytmusicapi")
            except Exception:
                ver = "unknown"
            return self.send_json(200, {"ok": True, "ytmusicapi": ver})
        route = ROUTES.get(u.path)
        if not route:
            return self.send_json(404, {"error": "not found"})
        try:
            return self.send_json(200, route(q))
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:
            print(u.path, "failed:", type(e).__name__, e, file=sys.stderr)
            return self.send_json(502, {"error": "YouTube Music didn't answer."})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3031)
    ap.add_argument("--watch-stdin", action="store_true", help="exit when the parent process closes our stdin")
    args = ap.parse_args()

    if args.watch_stdin:
        def watch():
            try:
                sys.stdin.buffer.read()
            finally:
                os._exit(0)

        threading.Thread(target=watch, daemon=True).start()

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    httpd.daemon_threads = True
    print("READY %d" % args.port, flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
