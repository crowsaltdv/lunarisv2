// Decides whether the raindrops are keeping up. Plain logic with no DOM, so it can be tested on its own.
//
// The one thing it must never do is blame the rain for something that isn't the rain. Browsers hand out
// frames very slowly (about one a second, or a stretch of ~20 a second while waking up) to a page that is in
// a background window, a hidden pane, an off-screen iframe, or just woke from sleep; that says nothing about
// the device. Two layers guard against that:
//   * createGovernor() watches the frames the rain draws and only becomes *suspicious*: it ignores frames
//     that arrive half a second or more apart (unless the rain's own work on them was slow), waits out a
//     warm-up, and needs several slow windows in a row
//   * startProbe() then settles it: the glue pauses the drawing and measures how fast the browser delivers
//     frames with nothing but an empty callback. Frames still slow with the rain paused means the rain isn't
//     the cause (leave it alone); frames fast again means it was.

export function createGovernor({ warmMs: warmStart = 4000, windowMs = 2000, badWindows = 3, ignoreAboveMs = 500, capMs = 250 } = {}) {
	let warmMs = warmStart;
	let warmUntil = 0;
	let sum = 0;
	let n = 0;
	let bad = 0;
	let first = true;

	const restart = (now) => {
		warmUntil = now + warmMs;
		sum = 0;
		n = 0;
		bad = 0;
	};

	return {
		// call when drawing (re)starts or the quality level changes
		reset(now) {
			restart(now);
			first = true;
		},
		// the rain was suspected but turned out not to be the cause (see startProbe): wait longer before suspecting it again
		slower() {
			warmMs = Math.min(warmMs * 3, 5 * 60e3);
		},
		// dt: ms since the previous drawn frame · work: ms the rain itself spent on this frame ·
		// slow: this level's limit for the average ms per frame · now: the frame's timestamp.
		// Returns the average ms per frame when the rain is suspected of being too slow, otherwise 0.
		sample(dt, work, slow, now) {
			if (first) {
				first = false; // the first frame after a start includes the whole pause
				return 0;
			}
			if (dt >= ignoreAboveMs && work < slow) {
				restart(now);
				return 0;
			}
			if (now < warmUntil) return 0;
			sum += Math.min(dt, capMs);
			n++;
			if (sum < windowMs) return 0;
			const avg = sum / n;
			sum = 0;
			n = 0;
			bad = avg > slow ? bad + 1 : 0;
			if (bad < badWindows) return 0;
			bad = 0;
			return avg;
		},
	};
}

// Is a frame due? `dt` is ms since the last drawn one, `fps` the level's cap. A frame is drawn once 80% of the
// wanted interval has passed, so a cap at or above the screen's refresh rate draws on every display frame
// (60 Hz stays 60, 144 Hz stays 144) and a low cap lands on every 2nd, 3rd... frame without drifting.
export function frameDue(dt, fps) {
	return dt >= (1000 / fps) * 0.8;
}

// Watches the browser's frame cadence with nothing but an empty callback running. raf is requestAnimationFrame
// (a parameter so tests can fake it). The first few frames are skipped (the GPU may still be finishing the
// rain's last frames) and each gap is capped. Resolves to the average ms between frames once `durationMs` worth of
// them has been seen, or to null if cancel() is called first (the glue cancels it if frames never come).
export function startProbe({ raf, durationMs = 1000, skipFrames = 6, capMs = 250 }) {
	let prev = 0;
	let skip = skipFrames;
	let sum = 0;
	let n = 0;
	let stopped = false;
	let resolveProbe;
	const promise = new Promise((resolve) => (resolveProbe = resolve));
	const tick = (t) => {
		if (stopped) return;
		if (prev) {
			if (skip > 0) skip--;
			else {
				sum += Math.min(t - prev, capMs);
				n++;
			}
		}
		prev = t;
		if (sum >= durationMs) {
			stopped = true;
			resolveProbe(sum / n);
			return;
		}
		raf(tick);
	};
	raf(tick);
	return {
		promise,
		cancel() {
			if (stopped) return;
			stopped = true;
			resolveProbe(null);
		},
	};
}
