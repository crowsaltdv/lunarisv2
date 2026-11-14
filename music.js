import express from "express";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

// Music comes from YouTube Music through ytmusicapi (https://github.com/sigma67/ytmusicapi), which is a Python library.
// ytmusic/service.py wraps it in a small JSON API that only listens on 127.0.0.1; this file starts that process, keeps it
// running, and passes the browser's /api/music/* requests through (with caching and input checks).
// ytmusicapi supplies the catalog (charts, search, albums, playlists, artists, radio). The page plays each song by its
// videoId through YouTube's own embedded player, so no audio ever passes through this server.
//
// Setup:  python -m pip install -r ytmusic/requirements.txt      (set YTMUSIC_PYTHON to use a specific python)
const SCRIPT = path.join(import.meta.dirname, "ytmusic", "service.py");
const INSTALL_HINT = 'Music needs Python with ytmusicapi. Run "python -m pip install -r ytmusic/requirements.txt" and restart the site.';

const svc = { port: 0, child: null, ready: false, starting: null, error: "", lastTry: 0 };

function pythonCommands() {
	if (process.env.YTMUSIC_PYTHON) return [[process.env.YTMUSIC_PYTHON]];
	return process.platform === "win32" ? [["python"], ["py", "-3"]] : [["python3"], ["python"]];
}

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.on("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
}

// starts one python candidate and resolves once it prints "READY <port>"
function launch(cmd, port) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd[0], [...cmd.slice(1), SCRIPT, "--port", String(port), "--watch-stdin"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let out = "";
		let err = "";
		let settled = false;
		const done = (fn, v) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(v);
		};
		const timer = setTimeout(() => {
			child.kill();
			done(reject, new Error("music service took too long to start"));
		}, 30e3);
		child.stdout.on("data", (d) => {
			out += d;
			if (/READY \d+/.test(out)) done(resolve, child);
		});
		child.stderr.on("data", (d) => {
			err = (err + d).slice(-4000);
			if (settled) console.error("[music]", String(d).trim());
		});
		child.on("error", (e) => done(reject, Object.assign(e, { spawnFailed: true })));
		child.on("exit", (code) => {
			if (svc.child === child) {
				svc.child = null;
				svc.ready = false;
				svc.error = svc.error || "The music service stopped.";
			}
			done(reject, Object.assign(new Error(/ModuleNotFoundError|No module named/i.test(err) ? INSTALL_HINT : err.trim().split("\n").pop() || `music service exited (${code})`), { missingModule: /ModuleNotFoundError|No module named/i.test(err) }));
		});
		child.stdin.on("error", () => {});
	});
}

function ensure() {
	if (svc.ready) return Promise.resolve();
	if (svc.starting) return svc.starting;
	if (svc.error && Date.now() - svc.lastTry < 15e3) return Promise.reject(new Error(svc.error));
	svc.lastTry = Date.now();
	svc.starting = (async () => {
		let last = null;
		for (const cmd of pythonCommands()) {
			try {
				const port = await freePort();
				svc.child = await launch(cmd, port);
				svc.port = port;
				svc.ready = true;
				svc.error = "";
				console.log(`Music: YouTube Music service (ytmusicapi) ready on 127.0.0.1:${port}`);
				return;
			} catch (e) {
				last = e;
				if (e.missingModule) break; // python works, the package is missing: another interpreter won't help
			}
		}
		svc.error = last && last.missingModule ? INSTALL_HINT : `Music couldn't start (${last ? last.message : "python not found"}). ${INSTALL_HINT}`;
		console.error("Music:", svc.error);
		throw new Error(svc.error);
	})().finally(() => {
		svc.starting = null;
	});
	return svc.starting;
}

process.on("exit", () => {
	try {
		svc.child?.kill();
	} catch {}
});

// ---- small response cache + a limit on how often one visitor can ask ----
const cache = new Map();
// `keep` can refuse to remember an answer (an empty search result shouldn't stick for ten minutes)
function cached(key, ttl, fn, keep) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.v);
	return fn().then((v) => {
		if (!keep || keep(v)) {
			cache.set(key, { at: Date.now(), v });
			if (cache.size > 400) cache.delete(cache.keys().next().value);
		}
		return v;
	});
}

async function upstream(pathAndQuery) {
	await ensure();
	const r = await fetch(`http://127.0.0.1:${svc.port}${pathAndQuery}`, { signal: AbortSignal.timeout(30e3) });
	const j = await r.json().catch(() => ({}));
	if (!r.ok) throw Object.assign(new Error(j.error || `music service ${r.status}`), { status: r.status });
	return j;
}

const hits = new Map();
function limited(ip) {
	const now = Date.now();
	const arr = (hits.get(ip) || []).filter((t) => now - t < 60e3);
	arr.push(now);
	hits.set(ip, arr);
	return arr.length > 90;
}

const ID = /^[A-Za-z0-9_-]{3,80}$/;
const MIN = 60e3;

export function musicRouter() {
	// warm it up at boot (the reason is logged above and shown in the music tab if it can't start), and have the front-page songs ready
	ensure().then(() => cached("/feed", 30 * MIN, () => upstream("/feed"))).catch(() => {});
	const r = express.Router();
	r.use((req, res, next) => (limited(req.ip) ? res.status(429).json({ error: "Slow down a little." }) : next()));

	const route = (name, ttl, build, fail, keep) =>
		r.get(name, async (req, res) => {
			const target = build(req);
			if (!target) return res.status(400).json({ error: "Bad request." });
			try {
				const v = await cached(target, ttl, () => upstream(target), keep);
				res.set("Cache-Control", "private, max-age=300").json(v);
			} catch (e) {
				if (e.status === 400) return res.status(400).json({ error: "Bad request." });
				res.status(svc.ready ? 502 : 503).json({ error: svc.ready ? fail : e.message });
			}
		});

	route("/feed", 30 * MIN, () => "/feed", "Couldn't load songs right now. Try again in a moment.");
	route(
		"/search",
		10 * MIN,
		(req) => {
			const q = String(req.query.q || "").trim().slice(0, 80);
			return q ? `/search?q=${encodeURIComponent(q)}` : "/search?q=";
		},
		"Search isn't available right now.",
		(v) => Boolean(v && (v.songs?.length || v.albums?.length || v.artists?.length || v.playlists?.length)),
	);
	route("/album", 60 * MIN, (req) => ID.test(String(req.query.id)) && `/album?id=${req.query.id}`, "Couldn't load that album.");
	route("/playlist", 60 * MIN, (req) => ID.test(String(req.query.id)) && `/playlist?id=${req.query.id}`, "Couldn't load that playlist.");
	route("/artist", 60 * MIN, (req) => ID.test(String(req.query.id)) && `/artist?id=${req.query.id}`, "Couldn't load that artist.");
	route("/radio", 10 * MIN, (req) => ID.test(String(req.query.id)) && `/radio?id=${req.query.id}`, "Couldn't find similar songs.");

	r.get("/status", (req, res) => res.json({ ready: svc.ready, error: svc.error || undefined }));
	return r;
}
