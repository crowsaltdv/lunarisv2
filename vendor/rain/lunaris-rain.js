// Lunaris glue for the Codrops RainEffect (see README.txt).
// Turns the chosen background image into the two textures the effect wants (a sharp one that
// shows through the drops and a blurred one for the glass) and manages size, the frame loop,
// start/stop and parallax.
//
// The effect redraws a full-screen canvas and re-uploads it to the GPU every frame, so what it costs
// scales with the number of pixels and frames. Three things keep that in check on weak machines:
//   * the canvas is only ever as large as the current quality level's pixel budget (the browser
//     stretches it to the window; the glass is soft anyway, so little is lost)
//   * one frame loop with a frame-rate cap per level (full quality follows the screen's refresh rate,
//     the lower levels draw about 30 a second)
//   * a governor (governor.js) that watches the real frames. When they stay slow it does not just lower
//     the quality: it first pauses the drawing for a second and watches the browser's frames on their own.
//     Only if they are fast again without the rain is the rain blamed, and the level drops (past the
//     lowest level the drops switch off). If they are slow either way (a throttled or just-woken window,
//     a busy machine) nothing changes. The level is only remembered for the browser session, so a new
//     session starts at full quality.
// (the ?v=4 on the changed files busts the 30-day "immutable" browser cache older copies were served with)
import Raindrops from "./raindrops.js?v=4";
import RainRenderer from "./rain-renderer.js?v=3";
import { createGovernor, frameDue, startProbe } from "./governor.js?v=4";
import createCanvas from "./create-canvas.js";

// mpx: pixel budget of the canvas · fps: frame cap · density: share of the usual number of drops
// slow: average ms per frame (over a 2 s window) above which this level counts as too slow
const LEVELS = [
	{ mpx: 1.1, fps: 165, density: 1, slow: 28 }, // full quality draws on every display frame (up to 165 per second): no visible cap on a 60, 120, 144 or 165 Hz screen
	{ mpx: 0.55, fps: 30, density: 0.8, slow: 45 },
	{ mpx: 0.3, fps: 30, density: 0.6, slow: 45 },
];
export const OFF = LEVELS.length;

// Remembered per browser session only (never localStorage): a wrong call must not outlive the tab. "Off" is
// never remembered either: after a reload the lowest level is tried again, and it switches off again within
// seconds if the device really can't keep up.
const KEY = "lunaris-rainq";
export function savedLevel() {
	try {
		localStorage.removeItem(KEY); // an earlier version kept this for a week: clear it so nobody stays locked out
		const l = parseInt(sessionStorage.getItem(KEY), 10);
		if (l > 0) return Math.min(l, OFF - 1);
	} catch {}
	return 0;
}
function saveLevel(l) {
	try {
		if (l > 0) sessionStorage.setItem(KEY, String(Math.min(l, OFF - 1)));
		else sessionStorage.removeItem(KEY);
	} catch {}
}
export function forgetLevel() {
	saveLevel(0);
}

function loadImg(src, cors = false) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		if (cors) img.crossOrigin = "anonymous";
		// a host that never answers must not leave the effect waiting forever
		const timer = setTimeout(() => {
			img.onload = img.onerror = null;
			img.src = "";
			reject(new Error("image timed out"));
		}, 25000);
		img.onload = () => {
			clearTimeout(timer);
			resolve(img);
		};
		img.onerror = () => {
			clearTimeout(timer);
			reject(new Error("image failed to load"));
		};
		img.src = src;
	});
}

// WebGL may only read images that allow it (CORS). Try the image directly first; only if its host refuses do we
// fetch it through our own server, which keeps the bandwidth off your hosting whenever possible.
async function loadPicture(url) {
	if (!/^https?:/i.test(url)) return loadImg(url);
	try {
		return await loadImg(url, true);
	} catch {
		return loadImg("/api/img?u=" + encodeURIComponent(url));
	}
}

function makeTextures(img, blur) {
	const ratio = img.naturalHeight / img.naturalWidth;
	// seen through the drops: small and soft, like the original demo
	const fg = createCanvas(256, Math.max(2, Math.round(256 * ratio)));
	fg.getContext("2d").drawImage(img, 0, 0, fg.width, fg.height);

	// the glass itself: the picture, blurred by the user's blur setting
	const bw = 1024;
	const bh = Math.max(2, Math.round(bw * ratio));
	const bg = createCanvas(bw, bh);
	const bx = bg.getContext("2d");
	if (blur > 0 && "filter" in bx) {
		const px = (blur * bw) / 1280;
		bx.filter = `blur(${px}px)`;
		bx.drawImage(img, -px * 2, -px * 2, bw + px * 4, bh + px * 4);
	} else if (blur > 0) {
		const sw = Math.max(8, Math.round(bw / (1 + blur * 0.6)));
		const small = createCanvas(sw, Math.max(2, Math.round(sw * ratio)));
		small.getContext("2d").drawImage(img, 0, 0, small.width, small.height);
		bx.imageSmoothingQuality = "high";
		bx.drawImage(small, 0, 0, bw, bh);
	} else {
		bx.drawImage(img, 0, 0, bw, bh);
	}
	return { fg, bg };
}

// hooks: onDisable() when the governor gives up · onLost() / onRestore() around a lost graphics context
export function createRainFx(canvas, hooks = {}) {
	let renderer = null;
	let drops = null;
	let dropAlpha = null;
	let dropColor = null;
	let scene = null; // { fg, bg } for the current picture + blur
	let sceneKey = "";
	let level = Math.min(savedLevel(), OFF - 1);
	let running = false; // the frame loop is going
	let desired = false; // what the page asked for with start()/stop(); the loop is also held while a probe runs
	let probing = false;
	let lost = false;
	let size = "";
	let px = 0;
	let py = 0;
	let tx = 0;
	let ty = 0;
	let raf = 0;
	let last = 0;
	const governor = createGovernor();
	const api = {
		ready: false,
		disabled: false,
		get lost() {
			return lost;
		},
		get level() {
			return level;
		},
		get running() {
			return running;
		},
	};

	async function loadDropArt() {
		if (dropAlpha) return;
		[dropAlpha, dropColor] = await Promise.all([
			loadImg(new URL("./img/drop-alpha.png", import.meta.url).href),
			loadImg(new URL("./img/drop-color.png", import.meta.url).href),
		]);
	}

	// canvas size for the current level: the window's shape, never more than 1 canvas pixel per CSS pixel, within the pixel budget
	function plan() {
		const w = Math.max(1, window.innerWidth);
		const h = Math.max(1, window.innerHeight);
		const q = Math.min(1, Math.sqrt((LEVELS[level].mpx * 1e6) / (w * h)));
		return { q, w: Math.max(2, Math.round(w * q)), h: Math.max(2, Math.round(h * q)) };
	}
	const planKey = () => {
		const p = plan();
		return p.w + "x" + p.h;
	};

	function build() {
		const p = plan();
		drops = new Raindrops(p.w, p.h, p.q, dropAlpha, dropColor, {
			trailRate: 1,
			trailScaleRange: [0.2, 0.45],
			collisionRadius: 0.45,
			dropletsCleaningRadiusMultiplier: 0.28,
			density: LEVELS[level].density,
		});
		// refraction and parallax are measured in canvas pixels: scaled with the canvas they look the same at every level
		const amounts = { minRefraction: 256 * p.q, maxRefraction: 512 * p.q, parallaxBg: 5 * p.q, parallaxFg: 20 * p.q };
		if (renderer) {
			renderer.resize(p.w, p.h, drops.canvas, amounts);
			renderer.setImages(scene.fg, scene.bg); // the picture or blur may have changed along with the size
			renderer.draw(); // resizing clears the canvas: paint it again right away so nothing flashes
		} else {
			canvas.width = p.w;
			canvas.height = p.h;
			renderer = new RainRenderer(canvas, drops.canvas, scene.fg, scene.bg, null, { brightness: 1.04, alphaMultiply: 6, alphaSubtract: 3, ...amounts });
		}
		size = p.w + "x" + p.h;
		if (running) {
			drops.resume();
			governor.reset(performance.now());
		}
	}

	function go() {
		if (running || lost || api.disabled || !drops) return;
		running = true;
		last = 0;
		drops.resume();
		governor.reset(performance.now());
		raf = requestAnimationFrame(frame);
	}
	function halt() {
		running = false;
		cancelAnimationFrame(raf);
	}

	function lower(avg, base) {
		level++;
		saveLevel(level);
		console.info(`Rain: frames take ${avg.toFixed(0)} ms with the drops running but ${base.toFixed(0)} ms without them, so ${level < OFF ? "the raindrop quality is going down (level " + level + ")" : "the raindrops are being turned off"}.`);
		if (level >= OFF) {
			api.disabled = true;
			halt();
			if (hooks.onDisable) hooks.onDisable();
			return;
		}
		build();
	}

	// The frames look slow. Is that the rain, or the browser (a throttled or just-woken window, a busy machine)?
	// Pause the drawing and watch the frames on their own: only if they are fast again is the rain to blame.
	function suspect(avg) {
		if (probing) return;
		probing = true;
		halt();
		const probe = startProbe({ raf: (cb) => requestAnimationFrame(cb) });
		const giveUp = setTimeout(() => probe.cancel(), 8000); // no frames at all (hidden window): nothing learned
		probe.promise.then((base) => {
			clearTimeout(giveUp);
			probing = false;
			const slow = LEVELS[level].slow;
			if (base !== null && base < slow * 0.7 && base < avg * 0.6) lower(avg, base);
			else governor.slower(); // slow with or without the rain: not its doing, so leave it alone and look again much later
			if (desired) go();
		});
	}

	// ---- the frame loop: simulation, upload and draw, in that order, once per frame ----
	function frame(t) {
		if (!running || lost) return;
		raf = requestAnimationFrame(frame);
		const dt = t - last;
		if (!frameDue(dt, LEVELS[level].fps)) return;
		last = t;
		const k = 1 - Math.pow(0.94, Math.min(dt, 100) / 16.667); // the same easing as 6% per frame at 60 fps
		px += (tx - px) * k;
		py += (ty - py) * k;
		renderer.parallaxX = px;
		renderer.parallaxY = py;
		const started = performance.now();
		drops.update();
		renderer.draw();
		const avg = governor.sample(dt, performance.now() - started, LEVELS[level].slow, t);
		if (avg) suspect(avg);
	}

	addEventListener(
		"pointermove",
		(e) => {
			tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1)) || 0; // clamped: a pointer far outside the window (or a bad value) must not fling the picture
			ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1)) || 0;
		},
		{ passive: true },
	);

	// a lost graphics context (driver reset, too many contexts) takes the textures with it: rebuild when it comes back
	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault();
		lost = true;
		api.ready = false;
		api.stop();
		if (hooks.onLost) hooks.onLost();
	});
	canvas.addEventListener("webglcontextrestored", () => {
		lost = false;
		renderer = null;
		try {
			if (scene) {
				build();
				api.ready = true;
			}
		} catch (err) {
			console.warn("Rain effect could not recover:", err);
		}
		if (hooks.onRestore) hooks.onRestore();
	});

	api.setScene = async (url, blur) => {
		if (lost) throw new Error("graphics context lost");
		await loadDropArt();
		const key = url + "|" + (blur || 0);
		let fresh = false;
		// the picture is only loaded and blurred again when it or the blur changed (not on a plain window resize)
		if (key !== sceneKey || !scene) {
			scene = makeTextures(await loadPicture(url), blur || 0);
			sceneKey = key;
			fresh = true;
		}
		if (!renderer || planKey() !== size) build();
		else if (fresh) renderer.setImages(scene.fg, scene.bg);
		api.ready = true;
	};
	api.start = () => {
		desired = true;
		if (!probing) go();
	};
	api.stop = () => {
		desired = false;
		halt();
	};
	// the user turned the drops back on: forget a slow spell and start from full quality again
	api.reset = () => {
		level = 0;
		api.disabled = false;
		forgetLevel();
		if (renderer && scene && !lost) build();
	};
	return api;
}
