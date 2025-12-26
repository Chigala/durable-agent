export type {
  StrategyOptions,
  StrategyExecutionFunctions,
  AgentExecutionStrategy,
} from "./types.js";

export { SimpleStrategy, createSimpleStrategy } from "./simple.js";
export { ReactStrategy, createReactStrategy } from "./react.js";

import type { AgentExecutionStrategy } from "./types.js";
import { SimpleStrategy } from "./simple.js";
import { ReactStrategy } from "./react.js";

/**
 * Map of strategy names to strategy instances
 */
export const strategies: Record<string, AgentExecutionStrategy> = {
  simple: new SimpleStrategy(),
  react: new ReactStrategy(),
};

/**
 * Get a strategy by name
 */
export function getStrategy(name: string): AgentExecutionStrategy {
  const strategy = strategies[name];
  if (!strategy) {
    throw new Error(
      `Unknown strategy: ${name}. Available strategies: ${Object.keys(strategies).join(", ")}`
    );
  }
  return strategy;
}
