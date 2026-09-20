export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

export interface LogEntry {
	timestamp: string;
	level: string;
	message: string;
	data?: Record<string, unknown>;
}

const recentEntries: LogEntry[] = [];

function write(level: string, message: string, data?: Record<string, unknown>): void {
	const entry = { timestamp: new Date().toISOString(), level, message, data } satisfies LogEntry;
	recentEntries.push(entry);
	if (recentEntries.length > 500) recentEntries.shift();
	console.log(JSON.stringify({ timestamp: entry.timestamp, level, message, ...data }));
}

export function getRecentLogs(limit = 50, level?: string): readonly LogEntry[] {
	return recentEntries.filter((entry) => !level || entry.level === level).slice(-limit);
}

export const logger: Logger = {
	debug: (message, data) => write("debug", message, data),
	info: (message, data) => write("info", message, data),
	warn: (message, data) => write("warn", message, data),
	error: (message, data) => write("error", message, data),
};
