import express from "express";

// The AI tab. The browser sends the conversation here; this file adds a short instruction, forwards it to the AI the visitor picked
// and streams the answer back. API keys stay on the server and never reach the browser.
//
// Which AIs appear in the picker depends on which keys are in the .env file (or in your host's environment settings). Each key
// switches on a few AIs, and every provider has its own free allowance, so more keys means more free messages a day:
//
//   GROQ_API_KEY            Llama 3.3 70B, GPT-OSS 120B and Llama 3.1 8B. Free plan, no card. (console.groq.com)
//   CLOUDFLARE_API_TOKEN    Llama 3.3 70B, Llama 3.1 8B and Gemma 3 12B. Free: 10,000 "neurons" a day.
//   CLOUDFLARE_ACCOUNT_ID   ...needs this too (your account id; dash.cloudflare.com).
//
//   Any other OpenAI-compatible provider (OpenRouter, Together, Ollama on your own PC, ...):
//   AI_API_KEY, AI_BASE_URL (its API address) and AI_MODEL (the model name); AI_MODEL_NAME is the name shown in the picker.
//
// One more AI needs no key at all: "Lunaris AI" runs inside the visitor's own browser (see assets/js/ai.js), so it is free and unlimited.
//
// Free plans are small and shared by every visitor, so each visitor is limited here too (AI_IP_PER_DAY, default 40 messages a day)
// and so is each AI (AI_MODEL_PER_DAY, default 900 a day, a little under Groq's free allowance). What people type is never logged.
const NEED_KEY = "The AI isn't switched on yet. The site owner needs to add an AI key (see ai.js).";
const SYSTEM =
	"You are a friendly, concise assistant built into a website with projects, music and TV. Help with homework explanations, writing, " +
	"coding, ideas and everyday questions. Keep answers short and clear unless asked for more. If a request is dangerous, hateful or " +
	"sexual, say you can't help with that and offer something else. Never ask for personal information. If asked, say you are an " +
	"AI and can make mistakes.";
const MAX_TOKENS = 700;
const MAX_PARALLEL = 6;
const IP_PER_MIN = 10;

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const env = (k) => (process.env[k] || "").trim();
const GSK = /^gsk_/;
const okBase = (b) => /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(b);

// ---- the AIs the site can offer, and the key each one needs ----
const PROVIDERS = [
	{
		id: "groq",
		via: "Groq",
		key: () => env("GROQ_API_KEY") || (GSK.test(env("AI_API_KEY")) ? env("AI_API_KEY") : ""),
		base: () => "https://api.groq.com/openai/v1",
		models: [
			{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
			// a "reasoning" model thinks before it answers, and that thinking uses the same token budget: keep it short, allow more room
			{ id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", extra: { reasoning_effort: "low" }, tokens: 1500 },
			{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (fast)" },
		],
	},
	{
		id: "cloudflare",
		via: "Cloudflare",
		key: () => env("CLOUDFLARE_API_TOKEN"),
		base: () => (/^[a-f0-9]{32}$/i.test(env("CLOUDFLARE_ACCOUNT_ID")) ? `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/ai/v1` : ""),
		models: [
			{ id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
			{ id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
			{ id: "@cf/google/gemma-3-12b-it", name: "Gemma 3 12B" },
		],
	},
	{
		id: "custom",
		via: "Custom",
		key: () => (GSK.test(env("AI_API_KEY")) ? "" : env("AI_API_KEY")),
		base: () => env("AI_BASE_URL"),
		models: () => (env("AI_MODEL") ? [{ id: env("AI_MODEL"), name: env("AI_MODEL_NAME") || env("AI_MODEL") }] : []),
	},
];

// the AIs that are switched on right now, with what is needed to call them
function available() {
	const out = [];
	for (const p of PROVIDERS) {
		const key = p.key();
		const base = (p.base() || "").replace(/\/+$/, "");
		if (!key || !base || !okBase(base)) continue;
		for (const m of typeof p.models === "function" ? p.models() : p.models) {
			out.push({ uid: `${p.id}:${m.id}`, label: `${m.name} · ${p.via}`, key, base, model: m.id, extra: m.extra || {}, tokens: m.tokens || MAX_TOKENS });
		}
	}
	return out;
}

// ---- limits: per visitor per minute and per day, and per AI per day ----
const minute = new Map();
const day = { key: "", ip: new Map(), model: new Map() };
let active = 0;
function tooMany(ip, uid) {
	const now = Date.now();
	const recent = (minute.get(ip) || []).filter((t) => now - t < 60e3);
	if (recent.length >= IP_PER_MIN) return "You're sending messages quickly. Wait a few seconds and try again.";
	const today = new Date().toISOString().slice(0, 10);
	if (day.key !== today) Object.assign(day, { key: today, ip: new Map(), model: new Map() });
	if ((day.ip.get(ip) || 0) >= num(process.env.AI_IP_PER_DAY, 40)) return "You've used today's AI messages. It resets tomorrow.";
	if ((day.model.get(uid) || 0) >= num(process.env.AI_MODEL_PER_DAY, 900)) return "That AI has reached its limit for today. Pick another one from the list, or try again tomorrow.";
	recent.push(now);
	minute.set(ip, recent);
	if (minute.size > 5000) minute.clear();
	day.ip.set(ip, (day.ip.get(ip) || 0) + 1);
	day.model.set(uid, (day.model.get(uid) || 0) + 1);
	return "";
}

// keeps only what the AI should see: recent user/assistant turns of sensible size, ending with a user message
function clean(list) {
	if (!Array.isArray(list)) return null;
	let out = [];
	for (const m of list.slice(-20)) {
		if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
		const content = m.content.trim().slice(0, 4000);
		if (content) out.push({ role: m.role, content });
	}
	// some providers insist that turns alternate, so neighbours with the same role (a question whose answer failed) are joined
	out = out.reduce((acc, m) => {
		const prev = acc[acc.length - 1];
		if (prev && prev.role === m.role) prev.content = (prev.content + "\n\n" + m.content).slice(0, 4000);
		else acc.push({ ...m });
		return acc;
	}, []);
	let total = out.reduce((n, m) => n + m.content.length, 0);
	while (out.length > 1 && total > 14000) total -= out.shift().content.length;
	while (out.length && out[0].role !== "user") out.shift();
	return out.length && out[out.length - 1].role === "user" ? out : null;
}

function upstreamError(status) {
	if (status === 401 || status === 403) return [503, "That AI didn't accept its key. The site owner should check it."];
	if (status === 404) return [503, "That AI isn't available right now. Try another one from the list."];
	if (status === 429) return [429, "That AI is out of free messages for a moment. Pick another one from the list, or try again in a minute."];
	return [502, "That AI had a problem. Try another one from the list, or try again in a moment."];
}

export function aiRouter() {
	if (env("AI_API_KEY") && !GSK.test(env("AI_API_KEY")) && !available().some((m) => m.uid.startsWith("custom:"))) {
		console.warn("AI: AI_API_KEY is set but the AI also needs AI_BASE_URL (https://...) and AI_MODEL (see ai.js).");
	}
	const r = express.Router();
	r.use(express.json({ limit: "64kb" }));

	// the AIs the picker offers that need a key (the on-device ones are added by the page itself)
	r.get("/models", (req, res) => res.json({ models: available().map((m) => ({ id: m.uid, name: m.label })) }));

	r.post("/chat", async (req, res) => {
		const list = available();
		if (!list.length) return res.status(503).json({ error: NEED_KEY });
		const pick = list.find((m) => m.uid === String(req.body?.model)) || list[0];
		const messages = clean(req.body?.messages);
		if (!messages) return res.status(400).json({ error: "Bad request." });
		const why = tooMany(req.ip, pick.uid);
		if (why) return res.status(429).json({ error: why });
		if (active >= MAX_PARALLEL) return res.status(429).json({ error: "The AI is busy right now. Try again in a few seconds." });

		active++;
		const ctl = new AbortController();
		res.on("close", () => ctl.abort()); // the visitor left or pressed Stop
		try {
			const up = await fetch(`${pick.base}/chat/completions`, {
				method: "POST",
				headers: { Authorization: `Bearer ${pick.key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
				body: JSON.stringify({ model: pick.model, stream: true, max_tokens: pick.tokens, temperature: 0.7, messages: [{ role: "system", content: SYSTEM }, ...messages], ...pick.extra }),
				signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(90e3)]),
			});
			if (!up.ok) {
				up.body?.cancel().catch(() => {});
				console.error(`AI: ${pick.uid} answered ${up.status}`);
				const [code, msg] = upstreamError(up.status);
				return res.status(code).json({ error: msg });
			}
			res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
			res.flushHeaders();
			const dec = new TextDecoder();
			let buf = "";
			let sent = 0;
			const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
			const line = (l) => {
				if (!l.startsWith("data:")) return false;
				const p = l.slice(5).trim();
				if (p === "[DONE]") return true;
				try {
					const t = JSON.parse(p).choices?.[0]?.delta?.content; // a reasoning model's thinking arrives in another field and is not shown
					if (typeof t === "string" && t) {
						sent += t.length;
						send({ t });
					}
				} catch {}
				return sent > 9000; // a runaway answer is cut off
			};
			stream: for await (const chunk of up.body) {
				buf += dec.decode(chunk, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop();
				for (const l of lines) if (line(l.trim())) break stream;
			}
			if (buf.trim()) line(buf.trim());
			res.write("data: [DONE]\n\n");
			res.end();
		} catch (e) {
			if (ctl.signal.aborted) return res.end(); // the visitor pressed Stop or left: nothing to report
			console.error(`AI: ${pick.uid} failed:`, e?.name === "TimeoutError" ? "timed out" : e?.message || e);
			if (!res.headersSent) return res.status(502).json({ error: "That AI couldn't be reached. Try another one from the list, or try again in a moment." });
			try {
				res.write(`data: ${JSON.stringify({ e: "The answer was cut off. Try again." })}\n\n`);
				res.end();
			} catch {}
		} finally {
			active--;
		}
	});

	return r;
}
