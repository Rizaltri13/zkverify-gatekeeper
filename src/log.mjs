// Tiny structured JSON-lines logger. Never log secrets or raw bodies.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || "info"] || 20;

export function log(level, event, fields = {}) {
  if ((LEVELS[level] || 20) < threshold) return;
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  process.stdout.write(JSON.stringify(line) + "\n");
}
