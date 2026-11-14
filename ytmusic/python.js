import fs from "node:fs";
import path from "node:path";

// The private Python environment install.js makes when the system Python won't take packages.
export const VENV = path.join(import.meta.dirname, ".venv");
export const VENV_PYTHON = path.join(VENV, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");

// Python interpreters to try, best first: YTMUSIC_PYTHON if it is set, then the private environment, then whatever is on PATH.
export function pythonCommands() {
	if (process.env.YTMUSIC_PYTHON) return [[process.env.YTMUSIC_PYTHON]];
	const system = process.platform === "win32" ? [["python"], ["py", "-3"]] : [["python3"], ["python"]];
	return fs.existsSync(VENV_PYTHON) ? [[VENV_PYTHON], ...system] : system;
}
