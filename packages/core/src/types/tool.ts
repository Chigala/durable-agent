import type { z } from "zod";

/**
 * Context passed to tool execute functions
 */
export interface ToolContext<TMemory = Record<string, unknown>> {
  /** Access to the durable step primitives */
  readonly step: DurableStepContext;
  /** Access to memory store */
  readonly memory: TMemory;
  /** Current agent iteration */
  readonly iteration: number;
}

/**
 * Durable step context available within tools
 */
export interface DurableStepContext {
  /**
   * Run a function as a durable step
   * Results are memoized and survive crashes
   */
  run<TResult>(name: string, fn: () => Promise<TResult>): Promise<TResult>;

  /**
   * Durable sleep - releases worker and resumes after duration
   * @param duration - Duration string like "1h", "30m", "1d"
   */
  sleep(duration: string): Promise<void>;
}

/**
 * Definition of an agent tool
 */
export interface ToolDefinition<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> {
  /** Human-readable description of what the tool does */
  readonly description: string;
  /** Zod schema for parameter validation */
  readonly parameters: TParams;
  /** Function that executes the tool */
  readonly execute: ToolExecuteFn<z.infer<TParams>, TResult>;
}

/**
 * Tool execution function signature
 */
export type ToolExecuteFn<TParams, TResult> = (
  params: TParams,
  context: ToolContext
) => Promise<TResult>;

/**
 * Registry of tools by name
 * Uses `any` for generics to allow assignment of specific tool types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolRegistry = Record<string, ToolDefinition<any, any>>;

/**
 * Extract parameter types from a tool registry
 */
export type ToolParams<T extends ToolRegistry> = {
  [K in keyof T]: T[K] extends ToolDefinition<infer P, infer _R>
    ? z.infer<P>
    : never;
};

/**
 * Extract result types from a tool registry
 */
export type ToolResults<T extends ToolRegistry> = {
  [K in keyof T]: T[K] extends ToolDefinition<infer _P, infer R> ? R : never;
};

/**
 * Record of a tool call for tracking/debugging
 */
export interface ToolCallRecord {
  /** Which iteration this tool was called in */
  readonly iteration: number;
  /** Name of the tool */
  readonly toolName: string;
  /** Unique ID for this call */
  readonly callId: string;
  /** Arguments passed to the tool */
  readonly args: unknown;
  /** Result from the tool (if completed) */
  readonly result?: unknown;
  /** Error message (if failed) */
  readonly error?: string;
  /** Timestamp when the call started */
  readonly startedAt: Date;
  /** Timestamp when the call completed */
  readonly completedAt?: Date;
}
