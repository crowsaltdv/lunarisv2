WebLLM 0.2.88 (@mlc-ai/web-llm, Apache-2.0 licence in LICENSE). web-llm-0.2.88.js is lib/index.js from the npm package, unchanged.
It lets the AI tab run a small AI model inside the visitor's own browser (WebGPU): nothing is sent to any AI service, and use is unlimited.
worker.js is the small background-thread wrapper the page starts. To update: replace web-llm-0.2.88.js with the new lib/index.js,
rename it with the new version, and change the file name in worker.js and in assets/js/ai.js.
The model files are downloaded by the visitor's browser from huggingface.co, and the model programs from raw.githubusercontent.com.
