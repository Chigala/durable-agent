import type { z } from "zod";
import type { Message, MessageHistory, ToolCall } from "./message.js";
import type { DurableStepContext, ToolCallRecord, ToolRegistry } from "./tool.js";

/**
 * Strategy for agent execution
 */
export type AgentStrategy = "simple" | "react";

/**
 * Configuration for agent memory
 */
export interface MemoryConfig {
  /** Type of memory to use */
  readonly type: "conversation" | "buffer";
  /** Maximum number of messages to retain */
  readonly maxMessages?: number;
  /** Summarize messages after this count */
  readonly summarizeAfter?: number;
  /** Function to create partition key for multi-tenant memory */
  readonly partitionKey?: (input: AgentInput) => string;
}

/**
 * Input provided when running an agent
 */
export interface AgentInput {
  /** The task or message for the agent */
  readonly task: string;
  /** Optional context data */
  readonly context?: Record<string, unknown>;
  /** Optional user identifier for memory partitioning */
  readonly userId?: string;
}

/**
 * Context available during agent execution
 */
export interface AgentContext<TTools extends ToolRegistry = ToolRegistry> {
  /** Original input to the agent */
  readonly input: AgentInput;
  /** Current conversation history */
  readonly messages: Message[];
  /** Available tools */
  readonly tools: TTools;
  /** Durable step primitives */
  readonly step: DurableStepContext;
  /** Current iteration number */
  iteration: number;
}

/**
 * Response from a model generation
 */
export interface ModelResponse {
  /** Generated text content */
  readonly text: string;
  /** Tool calls requested by the model */
  readonly toolCalls: readonly ToolCall[];
  /** Reason the model stopped generating */
  readonly finishReason: "stop" | "tool-calls" | "length" | "content-filter";
  /** Token usage statistics */
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/**
 * Status of a completed agent run
 */
export type AgentRunStatus =
  | "completed"
  | "max_iterations"
  | "cancelled"
  | "failed";

/**
 * Result from an agent execution
 */
export interface AgentResult {
  /** Final output from the agent */
  readonly output: string;
  /** Complete message history */
  readonly messages: MessageHistory;
  /** Number of iterations executed */
  readonly iterations: number;
  /** Record of all tool calls made */
  readonly toolCalls: readonly ToolCallRecord[];
  /** Final status of the run */
  readonly status: AgentRunStatus;
  /** Error message if status is "failed" */
  readonly error?: string;
}

/**
 * Hooks for customizing agent behavior
 */
export interface AgentHooks<TTools extends ToolRegistry = ToolRegistry> {
  /** Called before each iteration */
  beforeIteration?: (context: AgentContext<TTools>) => Promise<void>;
  /** Called after each iteration */
  afterIteration?: (
    context: AgentContext<TTools>,
    response: ModelResponse
  ) => Promise<void>;
  /** Called before each tool execution */
  beforeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    context: AgentContext<TTools>
  ) => Promise<void>;
  /** Called after each tool execution */
  afterToolCall?: (
    toolName: string,
    result: unknown,
    context: AgentContext<TTools>
  ) => Promise<void>;
  /** Called when an error occurs */
  onError?: (
    error: Error,
    context: AgentContext<TTools>
  ) => Promise<"retry" | "fail" | "continue">;
}

/**
 * Configuration for defining an agent
 */
export interface AgentConfig<TTools extends ToolRegistry = ToolRegistry> {
  /** Unique name for the agent */
  readonly name: string;
  /** Version identifier */
  readonly version?: string;
  /** System prompt for the agent */
  readonly system?: string;
  /** Tools available to the agent */
  readonly tools?: TTools;
  /** Execution strategy */
  readonly strategy?: AgentStrategy;
  /** Maximum iterations before stopping */
  readonly maxIterations?: number;
  /** Maximum tokens per model response */
  readonly maxTokens?: number;
  /** Memory configuration */
  readonly memory?: MemoryConfig;
  /** Lifecycle hooks */
  readonly hooks?: AgentHooks<TTools>;
  /** Input validation schema */
  readonly inputSchema?: z.ZodType<AgentInput>;
}

/**
 * Handle for a running or completed agent
 */
export interface AgentHandle {
  /** Unique identifier for this run */
  readonly id: string;
  /** Wait for and return the result */
  result(): Promise<AgentResult>;
  /** Cancel the running agent */
  cancel(): Promise<void>;
  /** Get current status */
  status(): Promise<AgentRunStatus | "pending" | "running">;
}

/**
 * Interface for a runnable agent
 */
export interface RunnableAgent<TTools extends ToolRegistry = ToolRegistry> {
  /** Agent configuration */
  readonly config: AgentConfig<TTools>;
  /** Run the agent with given input */
  run(input: AgentInput): Promise<AgentHandle>;
}
