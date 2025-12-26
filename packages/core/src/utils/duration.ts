/**
 * Duration unit multipliers in milliseconds
 */
const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  mo: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

/**
 * Regular expression to parse duration strings
 * Matches patterns like: "1h", "30m", "1d", "2w", "1mo", "500ms"
 */
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|mo|y)$/;

/**
 * Parse a duration string into milliseconds
 *
 * @param duration - Duration string like "1h", "30m", "1d", "2w", "1mo", "500ms"
 * @returns Duration in milliseconds
 * @throws Error if the duration format is invalid
 *
 * @example
 * ```ts
 * parseDuration("1h")   // 3600000
 * parseDuration("30m")  // 1800000
 * parseDuration("1d")   // 86400000
 * parseDuration("500ms") // 500
 * ```
 */
export function parseDuration(duration: string): number {
  const trimmed = duration.trim().toLowerCase();
  const match = DURATION_PATTERN.exec(trimmed);

  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". ` +
        `Expected format like "1h", "30m", "1d", "2w", "1mo", "500ms"`
    );
  }

  const value = parseFloat(match[1] as string);
  const unit = match[2] as string;
  const multiplier = DURATION_UNITS[unit];

  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: "${unit}"`);
  }

  return Math.floor(value * multiplier);
}

/**
 * Format milliseconds as a human-readable duration string
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 *
 * @example
 * ```ts
 * formatDuration(3600000)  // "1h"
 * formatDuration(1800000)  // "30m"
 * formatDuration(90000)    // "1m 30s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Check if a string is a valid duration format
 *
 * @param value - String to check
 * @returns True if the string is a valid duration format
 */
export function isValidDuration(value: string): boolean {
  return DURATION_PATTERN.test(value.trim().toLowerCase());
}
