Rain water effect: from codrops/RainEffect (https://github.com/codrops/RainEffect)
by Codrops (Codrops licensing: https://tympanus.net/codrops/licensing/). Article:
https://tympanus.net/codrops/2015/11/04/rain-water-effect-experiments/

Changes for Lunaris:
- ES-module imports, shaders inlined into shaders.js (generated from the original .vert/.frag),
  setImages() / resize() on the renderer.
- lunaris-rain.js is the Lunaris glue code. It owns the one frame loop (Raindrops.update() and
  RainRenderer.draw() each do a single step; neither schedules itself any more), the frame-rate cap
  and the pixel budget. See the comment at the top of that file for the quality levels. Full quality
  draws on every display frame (up to 165 a second); the lower levels draw about 30.
- governor.js decides when a device can't keep up and the quality should drop a level (past the lowest
  level the drops switch off). It works in two steps so it never blames the rain for something that
  isn't the rain (a hidden pane or background window delivers about one frame a second, and a window
  that just woke up a stretch of ~20 a second; neither says anything about the device):
    1. createGovernor() only becomes suspicious: it ignores throttled frames, waits out a warm-up and
       needs several slow windows in a row.
    2. startProbe() settles it: the glue pauses the drawing for about a second and watches the browser's
       frames on their own. Frames still slow without the rain = not the rain, nothing changes (and the
       next suspicion comes later); frames fast again = the rain, so the level drops.
  The level is remembered per browser session only. Both steps are plain functions of frame timing, so
  they can be tested without a browser.
- Speed: the 255 drop sprites share one sheet canvas (one texture instead of 255) that is built once;
  drop movement is scaled by elapsed time (the original moved drops a fixed step per frame, so they
  fell faster on a 144 Hz screen and in slow motion on a slow one); no per-frame allocations in the
  simulation or in random(); the water map is uploaded with texSubImage2D; the full-screen quad is
  uploaded once; the WebGL context is created without antialias/depth/stencil.
- Stability at high frame rates (raindrops.js). The simulation was only ever tuned for steps of about
  1/60 s. Anything that happens per *event* (a drop shedding a trail droplet) must not be scaled by the
  step size: it was (drop.r *= 0.97^timeScale), so at 165 steps a second drops lost a third as much
  mass per droplet, grew, merged, sped up and ran away: single drops reached thousands of pixels and
  the whole picture was refracted into violent shaking. It is now a constant 0.97. As belts and braces
  a merged drop can't exceed 2 * maxR (the original capped it against a property that doesn't exist),
  a drop's speed is capped at 60, and a clock that steps backwards can't run the simulation in reverse.
  Checked by simulating a minute at 30, 60, 120, 165 and 240 steps a second (with timing jitter and
  60 ms stalls too): worst drop radius ~60, worst speed ~45 at every rate, as at 60.
- The pointer-driven parallax is clamped (a pointer far outside the window, or a window that reports
  0 x 0, used to produce huge or NaN offsets).
- Raindrops.areaMultiplier is based on the screen's size in CSS pixels (it used to depend on the
  canvas resolution), with a "density" option.

Caching: server.js serves these scripts with "no-cache" (they used to be "immutable" for 30 days like
the fonts). The ?v= on the imports of the changed files is what made browsers drop the old copies once;
bump it on a file only if the scripts are ever served as immutable again.
