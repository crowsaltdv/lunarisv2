import express from "express";

// The Manga page uses two services. MangaDex (https://api.mangadex.org, docs at https://api.mangadex.org/docs/) supplies the titles,
// the covers and the chapters. Jikan (https://docs.api.jikan.moe, an unofficial MyAnimeList API) supplies the MyAnimeList rankings
// (top rated, most popular, ...) and the scores and details shown on a title's page; each ranked title is matched to its MangaDex
// title through the MyAnimeList id MangaDex keeps on it. Jikan is optional: when it isn't answering, only its orders stop working.
//
// MangaDex's side:
// MangaDex's API doesn't answer requests made by other websites' pages, so the browser asks this file instead: it makes the request,
// turns MangaDex's records into small, safe ones, and keeps recent answers in a cache. Covers are fetched and kept here too (MangaDex's
// image server turns away browsers on other websites). The pages of a chapter are loaded by the browser straight from MangaDex@Home,
// the way MangaDex asks readers to, and this file passes on the reports about how those loads went.
//
// Only titles rated "safe" or "suggestive" are ever shown.
const API = "https://api.mangadex.org";
const UA = "Lunaris-v2-manga-page/1.0";
const RATINGS = ["safe", "suggestive"];
const DOWN = "MangaDex isn't answering right now. Try again in a moment.";
const BUSY = "MangaDex is busy right now. Try again in a few seconds.";
const MIN = 60e3;
const HOUR = 60 * MIN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- asking MangaDex ----
// MangaDex allows about 5 requests a second from one address, so requests leave at most 4 times a second
let nextAt = 0;
async function slot() {
	const now = Date.now();
	const at = Math.max(now, nextAt);
	nextAt = at + 250;
	if (at > now) await sleep(at - now);
}
// after a failure, the next few seconds fail fast, so a busy page isn't made to wait for every request
let downAt = 0;
const gone = () => Object.assign(new Error(DOWN), { status: 502 });
async function md(path, params = {}, tries = 2) {
	if (Date.now() - downAt < 10e3) throw gone();
	const u = new URL(API + path);
	for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) if (x !== "" && x != null) u.searchParams.append(k, String(x));
	let last;
	for (let i = 0; i < tries; i++) {
		await slot();
		try {
			const r = await fetch(u, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(15e3) });
			if (r.status === 404 || r.status === 400) throw Object.assign(new Error("not found"), { status: r.status });
			if (r.status === 429) {
				// "x-ratelimit-retry-after" is the time (in seconds since 1970) when requests are welcome again
				const at = Number(r.headers.get("x-ratelimit-retry-after")) * 1000;
				if (i + 1 < tries) {
					await sleep(at ? Math.min(4000, Math.max(500, at - Date.now())) : 1500);
					continue;
				}
				throw Object.assign(new Error(BUSY), { status: 429 });
			}
			if (!r.ok) throw new Error(`MangaDex answered ${r.status}`);
			downAt = 0;
			return await r.json();
		} catch (e) {
			if (e?.status) throw e;
			last = e;
			if (i + 1 < tries) await sleep(600);
		}
	}
	downAt = Date.now();
	throw Object.assign(gone(), { cause: last });
}

// ---- asking Jikan (about 3 requests a second and 60 a minute are allowed) ----
const JIKAN = (process.env.JIKAN_API || "https://api.jikan.moe/v4").replace(/\/+$/, "");
const JDOWN = "MyAnimeList (through Jikan) isn't answering right now. Try again in a moment, or pick another order.";
const JBUSY = "MyAnimeList (through Jikan) is busy right now. Try again in a few seconds.";
let jNext = 0;
let jDownAt = 0;
const jCalls = [];
const jgone = () => Object.assign(new Error(JDOWN), { status: 502, pub: true });
async function jk(path, params = {}, tries = 2) {
	if (Date.now() - jDownAt < 20e3) throw jgone();
	const u = new URL(JIKAN + path);
	for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) u.searchParams.set(k, String(v));
	let last;
	for (let i = 0; i < tries; i++) {
		const now = Date.now();
		while (jCalls.length && now - jCalls[0] > 60e3) jCalls.shift();
		if (jCalls.length >= 50) throw Object.assign(new Error(JBUSY), { status: 429, pub: true });
		const at = Math.max(now, jNext);
		jNext = at + 400;
		if (at > now) await sleep(at - now);
		jCalls.push(Date.now());
		try {
			const r = await fetch(u, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(8e3) });
			if (r.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
			if (r.status === 429) {
				if (i + 1 < tries) {
					await sleep(1500);
					continue;
				}
				throw Object.assign(new Error(JBUSY), { status: 429, pub: true });
			}
			if (!r.ok) throw new Error(`Jikan answered ${r.status}`);
			jDownAt = 0;
			return await r.json();
		} catch (e) {
			if (e?.status) throw e;
			last = e;
			// a connection that timed out isn't tried again straight away
			if (e?.name === "TimeoutError" || e?.cause?.code) break;
			if (i + 1 < tries) await sleep(600);
		}
	}
	jDownAt = Date.now();
	throw Object.assign(jgone(), { cause: last });
}

// ---- cache: recent answers are reused, a failure is never remembered, and an old answer beats an error ----
const cache = new Map();
const inflight = new Map();
const STALE = 24 * HOUR;
async function cached(key, ttl, fn) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ttl) return hit.v;
	let p = inflight.get(key);
	if (!p) {
		p = fn()
			.then((v) => {
				cache.set(key, { at: Date.now(), v });
				if (cache.size > 500) cache.delete(cache.keys().next().value);
				return v;
			})
			.finally(() => inflight.delete(key));
		inflight.set(key, p);
	}
	try {
		return await p;
	} catch (e) {
		if (hit && e?.status !== 404 && e?.status !== 400 && Date.now() - hit.at < STALE) return hit.v;
		throw e;
	}
}
const hits = new Map();
function limited(ip) {
	const now = Date.now();
	const arr = (hits.get(ip) || []).filter((t) => now - t < 60e3);
	arr.push(now);
	hits.set(ip, arr);
	if (hits.size > 5000) hits.clear();
	return arr.length > 150;
}

// ---- turning MangaDex's records into small, safe ones ----
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG = /^[a-z]{2,3}(-[a-z]{2,4})?$/;
// a cover's file name: an id, then the picture's own extension
const COVER_FILE = /^[0-9a-f-]{36}\.(?:jpg|jpeg|png|gif|webp)$/i;
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
// MangaDex keeps names and descriptions per language, {"en": "..."}: English if there is one, otherwise whatever there is
const pick = (o) => (o && typeof o === "object" ? o.en || Object.values(o).find((x) => typeof x === "string" && x) || "" : "");
function titleOf(a) {
	if (a.title?.en) return a.title.en;
	const alt = (a.altTitles || []).find((t) => t?.en);
	return alt ? alt.en : pick(a.title);
}
const rel = (m, type) => (m.relationships || []).filter((r) => r.type === type);
function cover(m, size) {
	const f = rel(m, "cover_art")[0]?.attributes?.fileName;
	return UUID.test(m.id) && typeof f === "string" && COVER_FILE.test(f) ? `/api/manga/cover/${m.id}/${f}.${size}.jpg` : null;
}
const langs = (a) => (Array.isArray(a.availableTranslatedLanguages) ? [...new Set(a.availableTranslatedLanguages.filter((l) => typeof l === "string" && LANG.test(l)))].slice(0, 60) : []);
const tagNames = (a, groups, n) =>
	(a.tags || [])
		.filter((t) => groups.includes(t.attributes?.group))
		.map((t) => str(t.attributes?.name?.en, 30))
		.filter(Boolean)
		.slice(0, n);
function item(m) {
	const a = m.attributes || {};
	if (!UUID.test(m.id) || !RATINGS.includes(a.contentRating)) return null;
	return { id: m.id, title: str(titleOf(a), 200) || "Untitled", cover: cover(m, 256), description: str(pick(a.description), 300), langs: langs(a), status: str(a.status, 20), year: Number.isInteger(a.year) ? a.year : null, tags: tagNames(a, ["genre"], 3) };
}
function detail(m) {
	const a = m.attributes || {};
	if (!UUID.test(m.id) || !RATINGS.includes(a.contentRating)) return null;
	const title = str(titleOf(a), 200) || "Untitled";
	// the title as written in the original language, when it differs from the one shown
	const orig = str(Object.values(a.title || {})[0], 200);
	const people = [...rel(m, "author"), ...rel(m, "artist")].map((r) => str(r.attributes?.name, 60)).filter(Boolean);
	return {
		id: m.id,
		title,
		altTitle: orig && orig.toLowerCase() !== title.toLowerCase() ? orig : "",
		cover: cover(m, 512),
		description: str(pick(a.description).replace(/\r/g, ""), 3000),
		authors: [...new Set(people)].slice(0, 6),
		status: str(a.status, 20),
		year: Number.isInteger(a.year) ? a.year : null,
		originalLanguage: LANG.test(a.originalLanguage || "") ? a.originalLanguage : "",
		mal: /^\d{1,9}$/.test(String(a.links?.mal || "")) ? String(a.links.mal) : "",
		tags: tagNames(a, ["genre", "theme", "format"], 14),
		langs: langs(a),
		url: "https://mangadex.org/title/" + m.id,
	};
}
const web = (u) => (typeof u === "string" && /^https?:\/\/[^\s"'<>\\]{4,700}$/i.test(u) ? u : null);
function chapter(c) {
	const a = c.attributes || {};
	if (!UUID.test(c.id)) return null;
	const group = rel(c, "scanlation_group")
		.map((r) => str(r.attributes?.name, 50))
		.filter(Boolean)
		.join(", ");
	return { id: c.id, volume: str(a.volume, 10), chapter: str(a.chapter, 12), title: str(a.title, 160), pages: Number.isInteger(a.pages) ? a.pages : 0, date: str(a.publishAt || a.createdAt, 10), group, external: web(a.externalUrl) };
}
// the same chapter is often uploaded by several groups: one row per chapter number, keeping the longest upload
function oneEach(list) {
	const seen = new Map();
	const out = [];
	for (const c of list) {
		const key = c.chapter || c.volume ? `${c.volume}|${c.chapter}` : c.id;
		const i = seen.get(key);
		if (i == null) {
			seen.set(key, out.length);
			out.push(c);
		} else if (c.pages > out[i].pages && !c.external) out[i] = c;
	}
	return out;
}

// ---- covers: fetched with an honest user agent, a few at a time, and kept in memory ----
const covers = new Map();
let coverBytes = 0;
let coverBusy = 0;
const coverWaiting = [];
async function coverImage(path) {
	const hit = covers.get(path);
	if (hit) {
		covers.delete(path);
		covers.set(path, hit); // most recently used goes last
		return hit;
	}
	while (coverBusy >= 6) await new Promise((r) => coverWaiting.push(r));
	coverBusy++;
	try {
		const r = await fetch("https://uploads.mangadex.org/covers/" + path, { headers: { "User-Agent": UA, Accept: "image/jpeg,image/*" }, signal: AbortSignal.timeout(15e3) });
		if (!r.ok || !/^image\//i.test(r.headers.get("content-type") || "")) throw new Error("no cover");
		const buf = Buffer.from(await r.arrayBuffer());
		if (buf.length > 3e6) throw new Error("too large");
		covers.set(path, buf);
		coverBytes += buf.length;
		for (const [k, v] of covers) {
			if (coverBytes <= 32e6) break; // 32 MB is several hundred covers (tens of KB each); browsers keep every cover for a week anyway
			covers.delete(k);
			coverBytes -= v.length;
		}
		return buf;
	} finally {
		coverBusy--;
		coverWaiting.shift()?.();
	}
}

// the MyAnimeList orders: how Jikan is asked to sort its manga list
const MAL_ORDERS = {
	mal_score: { order_by: "rank", sort: "asc" },
	mal_popular: { order_by: "popularity", sort: "asc" },
	mal_favorite: { order_by: "favorites", sort: "desc" },
	mal_publishing: { status: "publishing", order_by: "popularity", sort: "asc" },
};
const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
const names = (list, n) => (Array.isArray(list) ? list.map((x) => str(x?.name, 60)).filter(Boolean).slice(0, n) : []);
// MangaDex's genre tags, {id, name}
function genreTags() {
	return cached("tags", 24 * HOUR, async () => {
		const j = await md("/manga/tag");
		return (j.data || [])
			.filter((t) => t.attributes?.group === "genre" && UUID.test(t.id))
			.map((t) => ({ id: t.id, name: str(t.attributes?.name?.en, 30) }))
			.filter((t) => t.name)
			.sort((a, b) => a.name.localeCompare(b.name));
	});
}
// MyAnimeList's genres by name ("Slice of Life" -> id), so MangaDex's genre menu can narrow a MyAnimeList order too
function jikanGenres() {
	return cached("jikan|genres", 24 * HOUR, async () => {
		const j = await jk("/genres/manga");
		return Object.fromEntries((j.data || []).filter((g) => Number.isInteger(g.mal_id)).map((g) => [norm(g.name), g.mal_id]));
	});
}
// one MyAnimeList title -> the MangaDex title with the same MyAnimeList id (null when MangaDex doesn't have it)
function dexFor(row) {
	return cached("mal|dex|" + row.mal_id, 24 * HOUR, async () => {
		const titles = [row.title, row.title_english].filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 2);
		for (const t of titles) {
			const r = await md("/manga", { limit: 10, title: str(t, 100), "includes[]": "cover_art", "contentRating[]": RATINGS });
			const hit = (r.data || []).find((m) => String(m.attributes?.links?.mal) === String(row.mal_id));
			if (hit) return item(hit);
		}
		return null;
	});
}
// what a title's page shows from MyAnimeList
function malInfo(m) {
	if (!m || !Number.isInteger(m.mal_id)) return null;
	return {
		id: m.mal_id,
		score: Number.isFinite(Number(m.score)) && Number(m.score) > 0 ? Math.round(Number(m.score) * 100) / 100 : null,
		scoredBy: int(m.scored_by),
		rank: int(m.rank),
		popularity: int(m.popularity),
		members: int(m.members),
		favorites: int(m.favorites),
		type: str(m.type, 20),
		status: str(m.status, 30),
		chapters: int(m.chapters),
		volumes: int(m.volumes),
		published: str(m.published?.string, 80),
		authors: names(m.authors, 5),
		serializations: names(m.serializations, 3),
		genres: names([...(m.genres || []), ...(m.themes || []), ...(m.demographics || [])], 12),
		synopsis: str(String(m.synopsis || "").replace(/\r/g, ""), 1500),
	};
}

const ORDERS = {
	popular: { "order[followedCount]": "desc" },
	latest: { "order[latestUploadedChapter]": "desc" },
	new: { "order[createdAt]": "desc" },
	rating: { "order[rating]": "desc" },
	az: { "order[title]": "asc" },
};
const PER = 24;

export function mangaRouter() {
	const r = express.Router();
	// a cover, 256 or 512 pixels wide: /api/manga/cover/<manga id>/<file>.256.jpg. MangaDex's image server answers browsers that come
	// from other websites with a refusal, so covers are fetched here (like any app would) and kept for a week.
	// (covers have their own, higher limit: a page of titles asks for two dozen at once)
	const coverHits = new Map();
	r.get("/cover/:id/:file", async (req, res) => {
		const now = Date.now();
		const recent = (coverHits.get(req.ip) || []).filter((t) => now - t < 60e3);
		recent.push(now);
		coverHits.set(req.ip, recent);
		if (coverHits.size > 5000) coverHits.clear();
		if (recent.length > 600) return res.status(429).end();
		const { id, file } = req.params;
		const m = /^([0-9a-f-]{36}\.(?:jpg|jpeg|png|gif|webp))\.(256|512)\.jpg$/i.exec(String(file));
		if (!UUID.test(String(id)) || !m) return res.status(404).end();
		try {
			const img = await coverImage(`${id}/${file}`);
			res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" }).send(img);
		} catch {
			res.status(404).end();
		}
	});

	r.use((req, res, next) => (limited(req.ip) ? res.status(429).json({ error: "Slow down a little." }) : next()));
	const fail = (res, e) => {
		if (e?.pub) return res.status(e.status || 502).json({ error: e.message });
		if (e?.status === 404 || e?.status === 400) return res.status(404).json({ error: "That wasn't found." });
		if (e?.status === 429) return res.status(429).json({ error: BUSY });
		res.status(502).json({ error: DOWN });
	};
	const send = (res, v, age = 300) => res.set("Cache-Control", `private, max-age=${age}`).json(v);
	const page = (req) => {
		const n = parseInt(req.query.page, 10);
		return Number.isFinite(n) ? Math.min(400, Math.max(1, n)) : 1;
	};

	// the catalogue: /api/manga/list?q=&lang=en&order=readable|popular|latest|new|rating|az&genre=<tag id>&page=1
	r.get("/list", async (req, res) => {
		const q = str(req.query.q, 100);
		const lang = LANG.test(String(req.query.lang || "")) ? String(req.query.lang) : "";
		const genre = UUID.test(String(req.query.genre || "")) ? String(req.query.genre) : "";
		const order = req.query.order === "readable" || Object.hasOwn(ORDERS, req.query.order) || Object.hasOwn(MAL_ORDERS, req.query.order) ? req.query.order : "readable";
		const n = page(req);
		const key = ["list", q.toLowerCase(), lang, genre, q ? "" : order, n].join("|");
		try {
			const out = await cached(key, 10 * MIN, async () => {
				// the MyAnimeList orders: Jikan ranks the titles, MangaDex gives each its name, cover and languages
				if (!q && Object.hasOwn(MAL_ORDERS, order)) {
					let genreId = "";
					if (genre) {
						// MangaDex's genre menu narrows these too, by matching the genre's name to MyAnimeList's
						try {
							const [tags, jg] = await Promise.all([genreTags(), jikanGenres()]);
							genreId = jg[norm(tags.find((t) => t.id === genre)?.name)] || "";
						} catch {}
					}
					const j = await jk("/manga", { page: n, limit: 12, sfw: "true", genres: genreId, ...MAL_ORDERS[order] });
					const items = [];
					for (const row of j.data || []) {
						let dx;
						try {
							dx = await dexFor(row);
						} catch (e) {
							// MangaDex stopped answering part way: what was matched so far is still a page
							if (items.length) break;
							throw e;
						}
						if (!dx || (lang && !dx.langs.includes(lang))) continue;
						items.push({ ...dx, mal: { score: Number(row.score) > 0 ? Number(row.score) : null, rank: int(row.rank), popularity: int(row.popularity) } });
					}
					return { items, total: null, page: n, pages: Math.min(100, Math.max(1, Number(j.pagination?.last_visible_page) || 1)) };
				}
				// "readable": the titles that just got chapters MangaDex itself hosts (many popular titles only have links to the
				// publisher's site, which can't be read here). A page is 100 recent chapters, which come to a few dozen titles.
				if (!q && order === "readable") {
					const j = await md("/chapter", {
						limit: 100,
						offset: (n - 1) * 100,
						"translatedLanguage[]": lang,
						includeExternalUrl: 0,
						includeEmptyPages: 0,
						"order[readableAt]": "desc",
						"includes[]": "manga",
						"contentRating[]": RATINGS,
					});
					const seen = new Set();
					const ids = [];
					for (const c of j.data || []) {
						const mg = rel(c, "manga")[0];
						if (!mg || !UUID.test(mg.id) || seen.has(mg.id)) continue;
						// the genre filter looks at the tags that came with each title
						if (genre && !(mg.attributes?.tags || []).some((t) => t.id === genre)) continue;
						seen.add(mg.id);
						ids.push(mg.id);
					}
					const pages = Math.min(100, Math.max(1, Math.ceil((Number(j.total) || 0) / 100)));
					if (!ids.length) return { items: [], total: null, page: n, pages };
					const details = await md("/manga", { limit: 100, "ids[]": ids, "includes[]": "cover_art", "contentRating[]": RATINGS });
					const byId = new Map((details.data || []).map((m) => [m.id, m]));
					return { items: ids.map((id) => byId.get(id)).filter(Boolean).map(item).filter(Boolean), total: null, page: n, pages };
				}
				const j = await md("/manga", {
					limit: PER,
					offset: (n - 1) * PER,
					"includes[]": "cover_art",
					"contentRating[]": RATINGS,
					hasAvailableChapters: "true",
					title: q,
					"availableTranslatedLanguage[]": lang,
					"includedTags[]": genre,
					...(q ? { "order[relevance]": "desc" } : ORDERS[order]),
				});
				const total = Math.min(10000, Number(j.total) || 0);
				return { items: (j.data || []).map(item).filter(Boolean), total, page: n, pages: Math.max(1, Math.ceil(total / PER)) };
			});
			send(res, out, 120);
		} catch (e) {
			fail(res, e);
		}
	});

	// the genres to filter by: /api/manga/tags
	r.get("/tags", async (req, res) => {
		try {
			send(res, { tags: await genreTags() }, 3600);
		} catch (e) {
			fail(res, e);
		}
	});

	// a title's details from MyAnimeList (through Jikan): /api/manga/mal/<MyAnimeList id>
	r.get("/mal/:id", async (req, res) => {
		const id = String(req.params.id || "");
		if (!/^\d{1,9}$/.test(id)) return res.status(404).json({ error: "That wasn't found." });
		try {
			const d = await cached("mal|full|" + id, 6 * HOUR, async () => {
				const v = malInfo((await jk(`/manga/${id}/full`)).data);
				if (!v) throw Object.assign(new Error("not found"), { status: 404 });
				return v;
			});
			send(res, d, 600);
		} catch (e) {
			fail(res, e);
		}
	});

	// one title: /api/manga/title/<id>
	r.get("/title/:id", async (req, res) => {
		const id = String(req.params.id || "");
		if (!UUID.test(id)) return res.status(404).json({ error: "That wasn't found." });
		try {
			const d = await cached("title|" + id, 30 * MIN, async () => {
				const j = await md("/manga/" + id, { "includes[]": ["author", "artist", "cover_art"] });
				const v = j.data ? detail(j.data) : null;
				if (!v) throw Object.assign(new Error("not found"), { status: 404 });
				return v;
			});
			send(res, d, 300);
		} catch (e) {
			fail(res, e);
		}
	});

	// a title's chapters in one language, oldest first: /api/manga/chapters/<id>?lang=en
	r.get("/chapters/:id", async (req, res) => {
		const id = String(req.params.id || "");
		const lang = String(req.query.lang || "en");
		if (!UUID.test(id) || !LANG.test(lang)) return res.status(404).json({ error: "That wasn't found." });
		try {
			const out = await cached(`chapters|${id}|${lang}`, 10 * MIN, async () => {
				const all = [];
				let total = 0;
				// MangaDex permits 500 feed records per request and caps offset + limit at 10,000.
				for (let off = 0; off < 10000; off += 500) {
					const j = await md(`/manga/${id}/feed`, {
						limit: 500,
						offset: off,
						"translatedLanguage[]": lang,
						"order[volume]": "asc",
						"order[chapter]": "asc",
						"contentRating[]": RATINGS,
						"includes[]": "scanlation_group",
					});
					total = Number(j.total) || total;
					all.push(...(j.data || []).map(chapter).filter(Boolean));
					if (off + 500 >= Math.min(total, 10000)) break;
				}
				// MangaDex only has pictures for chapters it hosts. The rest are official releases that live on the publisher's own site
				// (they have no pages here), so they are counted but not listed.
				const own = oneEach(all.filter((c) => c.pages > 0 && !c.external));
				const have = new Set(own.map((c) => `${c.volume}|${c.chapter}`));
				const elsewhere = oneEach(all.filter((c) => c.external && !(c.pages > 0))).filter((c) => !have.has(`${c.volume}|${c.chapter}`)).length;
				return { lang, chapters: own, elsewhere, truncated: total > 10000 };
			});
			send(res, out, 300);
		} catch (e) {
			fail(res, e);
		}
	});

	// the pages of one chapter: /api/manga/read/<chapter id>. MangaDex hands out a server for the pictures that works for about 15
	// minutes, so the answer is kept for 5; the browser then loads each picture from that server itself.
	r.get("/read/:id", async (req, res) => {
		const id = String(req.params.id || "");
		if (!UUID.test(id)) return res.status(404).json({ error: "That wasn't found." });
		try {
			const out = await cached("read|" + id, 5 * MIN, async () => {
				const j = await md("/at-home/server/" + id);
				const base = String(j.baseUrl || "");
				const hash = String(j.chapter?.hash || "");
				if (!/^https:\/\/[a-z0-9.-]+\.mangadex\.network(:\d+)?$/i.test(base) || !/^[a-f0-9]{16,64}$/i.test(hash)) throw gone();
				const files = (list, dir) => (Array.isArray(list) ? list : []).filter((f) => typeof f === "string" && /^[\w.-]{1,200}$/.test(f)).map((f) => `${base}/${dir}/${hash}/${f}`);
				return { images: files(j.chapter?.data, "data"), saver: files(j.chapter?.dataSaver, "data-saver") };
			});
			send(res, out, 60);
		} catch (e) {
			fail(res, e);
		}
	});

	// which titles have chapters that can be read here (MangaDex only has the pictures for chapters it hosts; many popular titles are
	// official releases it just links to): /api/manga/readable?lang=en&ids=<id>,<id>,... answers { ready: { <id>: number of chapters } }
	r.get("/readable", async (req, res) => {
		const lang = LANG.test(String(req.query.lang || "")) ? String(req.query.lang) : "";
		const ids = [...new Set(String(req.query.ids || "").split(",").filter((x) => UUID.test(x)))].slice(0, 12);
		const ready = {};
		try {
			for (const id of ids) {
				ready[id] = await cached(`ready|${id}|${lang}`, 30 * MIN, async () => {
					const j = await md(`/manga/${id}/feed`, { limit: 1, "translatedLanguage[]": lang, includeExternalUrl: 0, includeEmptyPages: 0, "contentRating[]": RATINGS });
					return Number(j.total) || 0;
				});
			}
			send(res, { ready }, 300);
		} catch (e) {
			// the answers so far are still good; the page treats a title it hasn't heard about as readable
			if (Object.keys(ready).length) return send(res, { ready }, 30);
			fail(res, e);
		}
	});

	// how loading the pictures of a chapter went. MangaDex asks readers to tell its page servers (MangaDex@Home) about every picture,
	// so the page sends its results here and this passes them on: { reports: [{ url, success, bytes, duration }] }
	r.post("/report", express.json({ limit: "20kb" }), (req, res) => {
		const list = Array.isArray(req.body?.reports) ? req.body.reports.slice(0, 40) : [];
		for (const x of list) {
			const url = String(x?.url || "");
			if (!/^https:\/\/[a-z0-9.-]+\.mangadex\.network(:\d+)?\/(?:data|data-saver)\/[a-f0-9]{16,64}\/[\w.-]{1,200}$/i.test(url)) continue;
			const num = (v, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.round(Number(v)))) : 0);
			fetch("https://api.mangadex.network/report", {
				method: "POST",
				headers: { "Content-Type": "application/json", "User-Agent": UA },
				body: JSON.stringify({ url, success: x.success === true, cached: false, bytes: num(x.bytes, 50e6), duration: num(x.duration, 120e3) }),
				signal: AbortSignal.timeout(8e3),
			}).catch(() => {});
		}
		res.status(204).end();
	});

	return r;
}
