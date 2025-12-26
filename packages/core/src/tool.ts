import type { z } from "zod";
import type { ToolDefinition, ToolExecuteFn } from "./types/index.js";

/**
 * Helper function to create a type-safe tool definition
 *
 * @example
 * ```ts
 * const searchTool = tool({
 *   description: "Search the web",
 *   parameters: z.object({ query: z.string() }),
 *   execute: async ({ query }) => {
 *     return await searchAPI.search(query);
 *   },
 * });
 * ```
 */
export function tool<TParams extends z.ZodTypeAny, TResult>(
  definition: ToolDefinition<TParams, TResult>
): ToolDefinition<TParams, TResult> {
  return Object.freeze({
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
  });
}

/**
 * Create a tool definition without implementation
 * Useful for declaring tool interfaces that will be implemented elsewhere
 */
export function declareTool<TParams extends z.ZodTypeAny, TResult = unknown>(
  definition: Omit<ToolDefinition<TParams, TResult>, "execute">
): Omit<ToolDefinition<TParams, TResult>, "execute"> {
  return Object.freeze({
    description: definition.description,
    parameters: definition.parameters,
  });
}

/**
 * Implement a declared tool
 */
export function implementTool<TParams extends z.ZodTypeAny, TResult>(
  declaration: Omit<ToolDefinition<TParams, TResult>, "execute">,
  execute: ToolExecuteFn<z.infer<TParams>, TResult>
): ToolDefinition<TParams, TResult> {
  return Object.freeze({
    description: declaration.description,
    parameters: declaration.parameters,
    execute,
  });
}
