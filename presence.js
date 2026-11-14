import express from "express";
import { rateLimit } from "./security.js";

// Counts people who currently have Lunaris v2 open. Each browser has a random id (kept in its localStorage) and
// checks in every 30 seconds; closing the page removes it immediately, and a browser that goes quiet drops
// off after PRESENCE_TTL_S seconds. No IPs are kept.
//
// By default the ids live only in this copy's memory, so each copy of the site (for example each Render service) shows its own number.
// To make every copy show the SAME number, point them all at one shared Redis database with the REDIS_URL environment variable:
//     REDIS_URL=rediss://default:password@your-host:6379
// (Render's "Key Value", Upstash's free Redis, or any other Redis; use the same address on every copy.) Each check-in is then written to
// one sorted set (visitor id + time) and the number shown is that set's size, so a visitor is counted once no matter which copy they
// reached. If the database can't be reached the copy falls back to counting its own visitors and picks the shared count up again
// when it is back. PRESENCE_REDIS_KEY changes the name the set is stored under (default "lunaris:presence"), for one database shared
// by several different sites. Only random ids and times are stored, and they expire by themselves.
const TTL = (Number(process.env.PRESENCE_TTL_S) || 150) * 1000;
const MAX_IDS = 50000;
const MAX_IDS_PER_IP = 10; // one network can't inflate the number by inventing visitors

const seen = new Map(); // id -> { t: last check-in, ip }   (this copy's own visitors; also what the per-network limit looks at)
const byIp = new Map(); // ip -> Set(ids)
const ID = /^[a-f0-9]{24}$/;

// ---- the shared database (optional) ----
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
const KEY = String(process.env.PRESENCE_REDIS_KEY || "lunaris:presence").slice(0, 80);
const DB_WAIT_MS = 1500; // a slow database must never hold a check-in up longer than this
let db = null;

function warn(what) {
	console.warn("Presence: " + what);
}
async function connectDb() {
	if (!REDIS_URL) return;
	let where;
	try {
		where = new URL(REDIS_URL).host; // only the host is ever printed, never the password
	} catch {
		return warn("REDIS_URL isn't a valid address (it should look like rediss://user:password@host:6379). Counting this copy's visitors only.");
	}
	let createClient;
	try {
		({ createClient } = await import("redis"));
	} catch {
		return warn("REDIS_URL is set but the redis package isn't installed (run npm install). Counting this copy's visitors only.");
	}
	const client = createClient({
		url: REDIS_URL,
		RESP: 2, // the plain, older protocol: the few commands used here need nothing newer, and it works with every Redis-compatible host
		disableOfflineQueue: true, // while the database is away, commands fail at once instead of piling up
		commandsQueueMaxLength: 600, // and while it is connected but not answering, only so many wait (about a hundred check-ins)
		socket: { connectTimeout: 5000, reconnectStrategy: (tries) => Math.min(500 * 2 ** Math.min(tries, 5), 15000) },
	});
	let down = false;
	client.on("error", (e) => {
		// it reports every failed retry; say so once when it goes down
		if (!down) warn(`can't reach the shared database at ${where} (${String(e?.code || e?.message || e).slice(0, 80)}). Counting this copy's visitors until it's back.`);
		down = true;
	});
	client.on("ready", () => {
		console.log(`Presence: ${down ? "shared database is back" : "shared through"} ${where}`);
		down = false;
	});
	db = client;
	client.connect().catch(() => {}); // it keeps retrying by itself; the site never waits for it
}
connectDb().catch((e) => warn("couldn't start the shared database connection: " + String(e?.message || e).slice(0, 100)));

// gives up on a database call after DB_WAIT_MS
function quick(promise) {
	let timer;
	return Promise.race([promise, new Promise((_, no) => (timer = setTimeout(() => no(new Error("slow")), DB_WAIT_MS)))]).finally(() => clearTimeout(timer));
}
// after a call timed out, the database is left alone for a few seconds, so a database that hangs doesn't make every check-in wait
let skipUntil = 0;
const dbUp = () => !!db && db.isReady && Date.now() >= skipUntil;
function failed(e) {
	if (e?.message === "slow") skipUntil = Date.now() + 10e3;
	return null;
}
// writes this visitor's check-in, drops everyone who has gone quiet, and returns how many visitors the whole database counts (null: not reachable)
async function sharedCheckIn(id) {
	if (!dbUp()) return null;
	const now = Date.now();
	try {
		const r = await quick(db.multi().zAdd(KEY, { score: now, value: id }).zRemRangeByScore(KEY, 0, now - TTL).zCard(KEY).expire(KEY, Math.ceil((TTL * 4) / 1000)).exec());
		const n = Number(r?.[2]);
		return Number.isInteger(n) && n >= 0 ? n : null;
	} catch (e) {
		return failed(e);
	}
}
// the same without adding anyone (a request that came without a usable id)
async function sharedCount() {
	if (!dbUp()) return null;
	try {
		const r = await quick(db.multi().zRemRangeByScore(KEY, 0, Date.now() - TTL).zCard(KEY).exec());
		const n = Number(r?.[1]);
		return Number.isInteger(n) && n >= 0 ? n : null;
	} catch (e) {
		return failed(e);
	}
}
function sharedLeave(id) {
	if (dbUp()) db.zRem(KEY, id).catch(() => {});
}

function drop(id) {
	const v = seen.get(id);
	if (!v) return;
	seen.delete(id);
	const set = byIp.get(v.ip);
	if (set) {
		set.delete(id);
		if (!set.size) byIp.delete(v.ip);
	}
}

function prune() {
	const cutoff = Date.now() - TTL;
	for (const [id, v] of seen) if (v.t < cutoff) drop(id);
}
setInterval(prune, 10e3).unref();

// this copy's own count: what is shown when there is no shared database, or while it can't be reached.
// recounted at most every 2 seconds so a burst of check-ins doesn't repeat the work
let cache = { at: 0, n: 0 };
function online() {
	const now = Date.now();
	if (now - cache.at > 2e3) {
		const cutoff = now - TTL;
		let n = 0;
		for (const v of seen.values()) if (v.t >= cutoff) n++;
		cache = { at: now, n };
	}
	return cache.n;
}

export function presenceRouter() {
	const r = express.Router();
	r.use(express.json({ limit: "200b" }));
	r.use(rateLimit({ windowMs: 60e3, max: 40, message: "Too many check-ins." }));

	r.post("/ping", async (req, res) => {
		const id = req.body?.id;
		let accepted = false;
		if (typeof id === "string" && ID.test(id)) {
			const known = seen.get(id);
			if (known) {
				known.t = Date.now();
				accepted = true;
			} else {
				// clear this network's expired visitors first, so stale entries never take up its slots
				const cutoff = Date.now() - TTL;
				for (const sid of [...(byIp.get(req.ip) || [])]) if ((seen.get(sid)?.t ?? 0) < cutoff) drop(sid);
				const set = byIp.get(req.ip) || new Set();
				if (set.size < MAX_IDS_PER_IP && seen.size < MAX_IDS) {
					seen.set(id, { t: Date.now(), ip: req.ip });
					set.add(id);
					byIp.set(req.ip, set);
					cache.at = 0; // a new visitor should show up right away
					accepted = true;
				}
			}
		}
		// only visitors this copy accepted are written to the shared database (so the per-network limit still applies)
		const shared = accepted ? await sharedCheckIn(id) : await sharedCount();
		res.json({ online: shared ?? online() });
	});

	r.post("/leave", (req, res) => {
		const id = req.body?.id;
		if (typeof id === "string" && ID.test(id)) {
			drop(id);
			sharedLeave(id);
			cache.at = 0;
		}
		res.status(204).end();
	});

	return r;
}
