// Emits one-line JSON log events. Fly.io parses these and surfaces `level` in
// the dashboard so you can filter by info / warn / error. Use via `log.info`,
// `log.warn`, `log.error`.

type Level = "info" | "warn" | "error";

function emit(
	level: Level,
	event: string,
	meta?: Record<string, unknown>,
): void {
	const line = JSON.stringify({
		time: new Date().toISOString(),
		level,
		event,
		...meta,
	});
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}

export const log = {
	info: (event: string, meta?: Record<string, unknown>) =>
		emit("info", event, meta),
	warn: (event: string, meta?: Record<string, unknown>) =>
		emit("warn", event, meta),
	error: (event: string, meta?: Record<string, unknown>) =>
		emit("error", event, meta),
};

// Extract loggable fields from an unknown caught value. Preserves the stack
// when available so Fly log entries retain debugging context.
export function errToMeta(err: unknown): Record<string, unknown> {
	if (err instanceof Error) {
		return { error: err.message, stack: err.stack };
	}
	return { error: String(err) };
}
