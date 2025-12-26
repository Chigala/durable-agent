/**
 * Generate a random ID with optional prefix
 *
 * @param prefix - Optional prefix for the ID
 * @param length - Length of the random part (default: 12)
 * @returns Generated ID string
 *
 * @example
 * ```ts
 * generateId()           // "a1b2c3d4e5f6"
 * generateId("step")     // "step_a1b2c3d4e5f6"
 * generateId("run", 8)   // "run_a1b2c3d4"
 * ```
 */
export function generateId(prefix?: string, length: number = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }

  return prefix ? `${prefix}_${result}` : result;
}

/**
 * Generate a unique step name based on base name and counter
 *
 * @param baseName - Base name for the step
 * @param counter - Map to track step name counts
 * @returns Unique step name
 */
export function generateStepName(
  baseName: string,
  counter: Map<string, number>
): string {
  const count = counter.get(baseName) ?? 0;
  counter.set(baseName, count + 1);

  return count === 0 ? baseName : `${baseName}-${count}`;
}

/**
 * Generate a tool call ID
 *
 * @param toolName - Name of the tool
 * @param iteration - Current iteration number
 * @returns Tool call ID
 */
export function generateToolCallId(
  toolName: string,
  iteration: number
): string {
  return `${toolName}-${iteration}-${generateId(undefined, 6)}`;
}
