export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function write(level: string, message: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...data }));
}

export const logger: Logger = {
  debug: (message, data) => write("debug", message, data),
  info: (message, data) => write("info", message, data),
  warn: (message, data) => write("warn", message, data),
  error: (message, data) => write("error", message, data),
};
