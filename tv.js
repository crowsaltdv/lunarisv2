import express from "express";

// The Watch page's TV catalogue comes from TMDB (https://developer.themoviedb.org). The browser never talks to TMDB: this file
// asks it on the page's behalf, so the API key stays on the server, and keeps recent answers in a small cache.
//
// Setup: put your TMDB "API Read Access Token" in the .env file next to server.js and restart:
//     TMDB_TOKEN=eyJ...
// (TMDB_API_KEY, the short v3 key, also works if no token is set.) On a host, set the same variable in its settings.
const API = "https://api.themoviedb.org/3";
const NEED_KEY = "Watch needs a TMDB key. Add TMDB_TOKEN=<your API read access token> to the .env file and restart the site.";
const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `status` on a thrown error decides what the page is told; messages with status 503 are ours and safe to show
async function tmdb(p, query = {}, tries = 2) {
	const token = process.env.TMDB_TOKEN;
	const key = process.env.TMDB_API_KEY;
	if (!token && !key) throw Object.assign(new Error(NEED_KEY), { status: 503 });
	const u = new URL(API + p);
	for (const [k, v] of Object.entries({ language: "en-US", ...query })) if (v !== "" && v != null) u.searchParams.set(k, String(v));
	const headers = { Accept: "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	else u.searchParams.set("api_key", key);
	for (let i = 0; i < tries; i++) {
		const r = await fetch(u, { headers, signal: AbortSignal.timeout(20e3) });
		if (r.status === 429 && i + 1 < tries) {
			await sleep(Math.min(3e3, (Number(r.headers.get("retry-after")) || 1) * 1e3));
			continue;
		}
		if (r.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
		if (r.status === 401 || r.status === 403) throw Object.assign(new Error("TMDB didn't accept the key in the .env file."), { status: 503 });
		if (!r.ok) throw Object.assign(new Error(`TMDB answered ${r.status}`), { status: 502 });
		return r.json();
	}
	throw Object.assign(new Error("TMDB is busy right now."), { status: 502 });
}

// ---- cache (a failure is never remembered) + a per-visitor limit ----
const cache = new Map();
function cached(key, ttl, fn) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ttl) return hit.v;
	const v = fn();
	cache.set(key, { at: Date.now(), v });
	if (cache.size > 500) cache.delete(cache.keys().next().value);
	v.catch(() => cache.delete(key));
	return v;
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
const int = (v, lo, hi, d) => {
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

// ---- turning TMDB's records into small, safe ones ----
// images are passed on as a path only ("/abc.jpg"); the page adds TMDB's image host and a size
const IMG = /^\/[\w-]{5,60}\.(?:jpg|jpeg|png|webp)$/;
const img = (p) => (typeof p === "string" && IMG.test(p) ? p : null);
const web = (u) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);
const rate = (s) => (s.vote_count >= 3 && s.vote_average > 0 ? Math.round(s.vote_average * 10) / 10 : null);
const str = (v, n) => String(v ?? "").slice(0, n);

function genres(type = "tv") {
 return cached("genres:" + type, DAY, async () => {
  const j = await tmdb(`/genre/${type}/list`);
		const byName = new Map();
		const byId = new Map();
		for (const g of j.genres || []) {
			byName.set(g.name, g.id);
			byId.set(g.id, g.name);
		}
		return { list: [...byName.keys()].sort((a, b) => a.localeCompare(b)), byName, byId };
	});
}
function compact(s, g) {
	return {
		t: "tv",
		id: s.id,
		n: str(s.name || s.original_name, 120),
		i: img(s.poster_path),
		p: s.first_air_date || null,
		g: (s.genre_ids || []).map((id) => g.byId.get(id)).filter(Boolean).slice(0, 3),
		r: rate(s),
	};
}
function compactMovie(s,g){return{t:"movie",id:s.id,n:str(s.title||s.original_title,120),i:img(s.poster_path),p:s.release_date||null,g:(s.genre_ids||[]).map(id=>g.byId.get(id)).filter(Boolean).slice(0,3),r:rate(s)}}

const dayOffset = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
// each sort is a TMDB "discover" query; a genre filter and paging go on top of it
const SORTS = {
	popular: () => ({ sort_by: "popularity.desc", "vote_count.gte": 15 }),
	rating: () => ({ sort_by: "vote_average.desc", "vote_count.gte": 200 }),
	new: () => ({ sort_by: "popularity.desc", "first_air_date.gte": dayOffset(-120), "first_air_date.lte": dayOffset(0) }),
	today: () => ({ sort_by: "popularity.desc", "air_date.gte": dayOffset(0), "air_date.lte": dayOffset(0) }),
};
const discover = (query, page) => cached("d:" + JSON.stringify([query, page]), 10 * MIN, () => tmdb("/discover/tv", { ...query, page }));
const MOVIE_SORTS={popular:()=>({sort_by:"popularity.desc","vote_count.gte":15}),rating:()=>({sort_by:"vote_average.desc","vote_count.gte":200}),new:()=>({sort_by:"primary_release_date.desc","primary_release_date.gte":dayOffset(-365),"primary_release_date.lte":dayOffset(0)}),today:()=>({sort_by:"popularity.desc","primary_release_date.gte":dayOffset(0),"primary_release_date.lte":dayOffset(0)})};
const discoverMovies=(query,page)=>cached("dm:"+JSON.stringify([query,page]),10*MIN,()=>tmdb("/discover/movie",{...query,page}));

const STATUS = { "Returning Series": "Running", "In Production": "In production", Planned: "Planned", Pilot: "Pilot", Ended: "Ended", Canceled: "Canceled" };
function detail(s) {
	const net = (s.networks || [])[0];
	const done = s.status === "Ended" || s.status === "Canceled";
	const nx = s.next_episode_to_air;
	return {
		id: s.id,
		n: str(s.name || s.original_name, 120),
		i: img(s.poster_path),
		b: img(s.backdrop_path),
		p: s.first_air_date || null,
		g: (s.genres || []).map((x) => x.name).slice(0, 6),
		r: rate(s),
		s: STATUS[s.status] || null,
		tag: str(s.tagline, 200),
		summary: str(s.overview, 1500).trim(),
		type: s.type || null,
		lang: s.original_language || null,
		rt: (s.episode_run_time || [])[0] || s.last_episode_to_air?.runtime || null,
		ended: done ? s.last_air_date || null : null,
		official: web(s.homepage),
		imdb: /^tt\d{5,10}$/.test(s.external_ids?.imdb_id || "") ? s.external_ids.imdb_id : null,
		url: `https://www.themoviedb.org/tv/${s.id}`,
		ch: net ? { n: str(net.name, 80) } : null,
		next: nx && Number.isInteger(nx.season_number) && Number.isInteger(nx.episode_number) ? { s: nx.season_number, e: nx.episode_number, n: str(nx.name, 160), d: nx.air_date || null } : null,
		cast: (s.credits?.cast || []).slice(0, 16).map((c) => ({ p: str(c.name, 80), c: str(c.character, 80), i: img(c.profile_path) })),
		seasons: (s.seasons || []).filter((x) => x.season_number > 0 && x.episode_count > 0).map((x) => ({ n: x.season_number, c: x.episode_count, d: x.air_date || null })),
	};
}
function movieDetail(s){return{id:s.id,n:str(s.title||s.original_title,120),i:img(s.poster_path),b:img(s.backdrop_path),p:s.release_date||null,g:(s.genres||[]).map(x=>x.name).slice(0,6),r:rate(s),s:null,tag:str(s.tagline,200),summary:str(s.overview,1500).trim(),type:"Movie",lang:s.original_language||null,rt:s.runtime||null,ended:null,official:web(s.homepage),imdb:/^tt\d{5,10}$/.test(s.external_ids?.imdb_id||"")?s.external_ids.imdb_id:null,url:`https://www.themoviedb.org/movie/${s.id}`,ch:null,next:null,cast:(s.credits?.cast||[]).slice(0,16).map(c=>({p:str(c.name,80),c:str(c.character,80),i:img(c.profile_path)})),seasons:[]}}
function season(j) {
	return {
		eps: (j.episodes || [])
			.filter((e) => Number.isInteger(e.episode_number))
			.map((e) => ({ e: e.episode_number, n: str(e.name, 160), d: e.air_date || null, rt: e.runtime || null, r: rate(e), t: str(e.overview, 600).trim(), i: img(e.still_path) })),
	};
}
export function tvRouter() {
	const r = express.Router();
	r.use((req, res, next) => (limited(req.ip) ? res.status(429).json({ error: "Slow down a little." }) : next()));
	const fail = (res, e, msg) => {
		if (e?.status === 503) return res.status(503).json({ error: e.message });
		if (e?.status === 404) return res.status(404).json({ error: "That wasn't found." });
		res.status(502).json({ error: msg });
	};
	const send = (res, v, age = 300) => res.set("Cache-Control", `private, max-age=${age}`).json(v);

	// the catalogue: /api/tv/shows?sort=popular|rating|new|today&genre=Drama&offset=0&limit=60
	r.get("/shows", async (req, res) => {
		const sort = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : "popular";
		const off = int(req.query.offset, 0, 9980, 0);
		const lim = int(req.query.limit, 1, 60, 60);
		try {
			const g = await genres();
			const name = String(req.query.genre || "").slice(0, 30);
			const gid = name ? g.byName.get(name) : null;
			if (name && !gid) return send(res, { total: 0, items: [], genres: g.list });
			const query = { ...SORTS[sort](), ...(gid ? { with_genres: gid } : {}), include_null_first_air_dates: "false" };
			// TMDB pages hold 20 shows; a request for 60 reads three of them
			const first = Math.floor(off / 20) + 1;
			const last = Math.min(500, Math.floor((off + lim - 1) / 20) + 1);
			const pages = await Promise.all(Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => discover(query, first + i)));
			const skip = off - (first - 1) * 20;
			const items = pages.flatMap((p) => p.results || []).slice(skip, skip + lim).map((s) => compact(s, g));
			send(res, { total: Math.min(10000, pages[0]?.total_results || 0), items, genres: g.list }, 120);
		} catch (e) {
			fail(res, e, "Couldn't load shows right now.");
		}
	});

	r.get("/movies", async (req,res)=>{
		const sort=Object.hasOwn(MOVIE_SORTS,req.query.sort)?req.query.sort:"popular",off=int(req.query.offset,0,9980,0),lim=int(req.query.limit,1,60,60);
		try{
			const g=await genres("movie"),name=String(req.query.genre||"").slice(0,30),gid=name?g.byName.get(name):null;
			if(name&&!gid)return send(res,{total:0,items:[],genres:g.list});
			const query={...MOVIE_SORTS[sort](),...(gid?{with_genres:gid}:{}),include_adult:"false"};
			const first=Math.floor(off/20)+1,last=Math.min(500,Math.floor((off+lim-1)/20)+1);
			const pages=await Promise.all(Array.from({length:Math.max(0,last-first+1)},(_,i)=>discoverMovies(query,first+i)));
			const skip=off-(first-1)*20,items=pages.flatMap(p=>p.results||[]).slice(skip,skip+lim).map(s=>compactMovie(s,g));
			send(res,{total:Math.min(10000,pages[0]?.total_results||0),items,genres:g.list},120);
		}catch(e){fail(res,e,"Couldn't load movies right now.")}
	});

	r.get("/search", async (req, res) => {
		const q = String(req.query.q || "").trim().slice(0, 80);
		if (!q) return res.json({ items: [] });
		try {
			const g = await genres();
			const pages = await Promise.all([1, 2].map((n) => cached(`s:${q.toLowerCase()}:${n}`, 10 * MIN, () => tmdb("/search/tv", { query: q, include_adult: "false", page: n }))));
			send(res, { items: pages.flatMap((p) => p.results || []).slice(0, 40).map((s) => compact(s, g)) });
		} catch (e) {
			fail(res, e, "Search isn't available right now.");
		}
	});

	r.get("/search-movies",async(req,res)=>{
		const q=String(req.query.q||"").trim().slice(0,80);if(!q)return res.json({items:[]});
		try{const g=await genres("movie"),pages=await Promise.all([1,2].map(n=>cached(`sm:${q.toLowerCase()}:${n}`,10*MIN,()=>tmdb("/search/movie",{query:q,include_adult:"false",page:n}))));send(res,{items:pages.flatMap(p=>p.results||[]).slice(0,40).map(s=>compactMovie(s,g))})}
		catch(e){fail(res,e,"Movie search isn't available right now.")}
	});

	r.get("/show", async (req, res) => {
		const id = String(req.query.id || "");
		if (!/^\d{1,8}$/.test(id)) return res.status(400).json({ error: "Bad request." });
		try {
			send(res, await cached("show:" + id, 30 * MIN, async () => detail(await tmdb(`/tv/${id}`, { append_to_response: "credits,external_ids" }))));
		} catch (e) {
			fail(res, e, "Couldn't load that show.");
		}
	});

	r.get("/movie",async(req,res)=>{
		const id=String(req.query.id||"");if(!/^\d{1,8}$/.test(id))return res.status(400).json({error:"Bad request."});
		try{send(res,await cached("movie:"+id,30*MIN,async()=>movieDetail(await tmdb(`/movie/${id}`,{append_to_response:"credits,external_ids"}))))}
		catch(e){fail(res,e,"Couldn't load that movie.")}
	});

	// one season's episodes (the page asks for a season when it is opened)
	r.get("/season", async (req, res) => {
		const id = String(req.query.id || "");
		const n = String(req.query.n || "");
		if (!/^\d{1,8}$/.test(id) || !/^\d{1,3}$/.test(n)) return res.status(400).json({ error: "Bad request." });
		try {
			send(res, await cached(`season:${id}:${n}`, 30 * MIN, async () => season(await tmdb(`/tv/${id}/season/${n}`))));
		} catch (e) {
			fail(res, e, "Couldn't load that season.");
		}
	});

	return r;
}
