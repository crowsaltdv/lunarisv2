// Runs the on-device AI in a background thread so the page stays responsive while it thinks.
import { WebWorkerMLCEngineHandler } from "./web-llm-0.2.88.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
