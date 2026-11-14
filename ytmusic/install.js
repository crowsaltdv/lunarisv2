// Installs ytmusicapi (https://github.com/sigma67/ytmusicapi), the Python library behind the music tab.
// It is a Python package, so npm can't fetch it itself: "npm install" runs this file afterwards (the "postinstall" script in
// package.json) and it asks pip to. "npm run music:install" runs it by hand.
//
// It installs into the Python it finds, the way "pip install" normally does. Some systems (recent Debian and Ubuntu) don't let
// pip add to the system Python; there it makes a private environment in ytmusic/.venv instead, and music.js starts the music
// service from that.
//
// A problem here never fails "npm install": everything except the music tab works without it.
import "../env.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { VENV, VENV_PYTHON, pythonCommands } from "./python.js";

const REQUIREMENTS = path.join(import.meta.dirname, "requirements.txt");
const PIP_INSTALL = ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--no-input", "-r", REQUIREMENTS];

function run(cmd, args, timeout = 5 * 60e3) {
	const r = spawnSync(cmd[0], [...cmd.slice(1), ...args], { encoding: "utf8", windowsHide: true, timeout });
	return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() || r.error?.message || "" };
}

// the end of pip's (often long) error output, which is where it says what went wrong
const tail = (text) => text.split(/\r?\n/).filter((l) => l.trim()).slice(-6).join("\n  ");

function install() {
	const py = pythonCommands().find((cmd) => run(cmd, ["--version"], 30e3).ok);
	if (!py) return { error: "Python 3 wasn't found. Install it from https://www.python.org/downloads/ (or set YTMUSIC_PYTHON to where it is)." };
	const direct = run(py, PIP_INSTALL);
	if (direct.ok) return { py };
	// YTMUSIC_PYTHON names the one Python to use, and a private environment that already exists has nothing to fall back to
	if (process.env.YTMUSIC_PYTHON || py[0] === VENV_PYTHON) return { error: tail(direct.err) };

	// pip wouldn't add to that Python (usually "externally-managed-environment"): use a private environment instead
	const made = run(py, ["-m", "venv", VENV], 2 * 60e3);
	const inVenv = made.ok ? run([VENV_PYTHON], PIP_INSTALL) : made;
	if (inVenv.ok) return { py: [VENV_PYTHON] };
	fs.rmSync(VENV, { recursive: true, force: true }); // a half-made environment would be picked over a working Python later
	return { error: tail(inVenv.err || direct.err) };
}

const { py, error } = install();
if (py) {
	const version = run(py, ["-c", "from importlib.metadata import version; print(version('ytmusicapi'))"], 30e3).out;
	console.log(`Music: ytmusicapi ${version} is installed (${py[0] === VENV_PYTHON ? "in ytmusic/.venv" : py.join(" ")}).`);
} else {
	console.warn(`Music: couldn't install ytmusicapi, so the music tab stays off for now. Everything else works.\n  ${error}\n  Once that is sorted out, run: npm run music:install`);
	if (process.env.npm_lifecycle_event !== "postinstall") process.exitCode = 1;
}
