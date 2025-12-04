import type { LogLevel } from "../../services/logs.js"

/**
 * Log level color mappings for display
 * Maps log levels to their corresponding colors
 */
export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
	info: "blue",
	debug: "yellow",
	warn: "magenta",
	error: "red",
}

/**
 * Log level icon mappings for display
 * Maps log levels to their corresponding emoji icons
 */
export const LOG_LEVEL_ICONS: Record<LogLevel, string> = {
	info: "🔵",
	debug: "🟡",
	warn: "🟠",
	error: "🔴",
}

/**
 * All available log levels in order of severity
 */
export const LOG_LEVELS: LogLevel[] = ["info", "debug", "warn", "error"]

/**
 * Default log levels that are enabled by default
 */
export const DEFAULT_LOG_LEVELS: Set<LogLevel> = new Set(["info", "debug", "warn", "error"])

/**
 * Log level display configuration
 */
export interface LogLevelConfig {
	level: LogLevel
	color: string
	icon: string
	label: string
}

/**
 * Get log level configuration
 * @param level - Log level
 * @returns Configuration object with color, icon, and label
 */
export const getLogLevelConfig = (level: LogLevel): LogLevelConfig => {
	return {
		level,
		color: LOG_LEVEL_COLORS[level],
		icon: LOG_LEVEL_ICONS[level],
		label: level.toUpperCase(),
	}
}

/**
 * Get all log level configurations
 * @returns Array of all log level configurations
 */
export const getAllLogLevelConfigs = (): LogLevelConfig[] => {
	return LOG_LEVELS.map(getLogLevelConfig)
}
