import type { z } from "zod";
import type { Message, MessageHistory, ToolCall } from "./message.js";
import type {
  DurableStepContext,
  ToolCallRecord,
  ToolRegistry,
} from "./tool.js";
import type { Backend } from "openworkflow";
import type { LanguageModel } from "ai";

/**
 * Configuration for DurableAgent
 */
export interface DurableAgentConfig {
  /** OpenWorkflow backend (SQLite or Postgres) */
  readonly backend: Backend;
  /** AI SDK language model */
  readonly model: LanguageModel;
  /** Worker concurrency (default: 1) */
  readonly concurrency?: number;
}

/**
 * Strategy for agent execution
 */
export type AgentStrategy = "simple" | "react";

/**
 * Input provided when running an agent
 */
export interface AgentInput {
  /** The task or message for the agent */
  readonly task: string;
  /** Optional context data */
  readonly context?: Record<string, unknown>;
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

/**
 * Handle for a defined agent
 */
export interface DefinedAgent {
  /** Agent configuration */
  readonly config: { readonly name: string };
  /** Run the agent with given input */
  run(input: AgentInput): Promise<AgentRunHandle>;
}

/**
 * Handle for a running agent
 */
export interface AgentRunHandle {
  /** Unique identifier for this run */
  readonly id: string;
  /** Wait for and return the result */
  result(): Promise<AgentResult>;
  /** Cancel the running agent */
  cancel(): Promise<void>;
}

/**
 * Configuration for sequential agent composition
 */
export interface SequentialAgentConfig {
  /** Unique name for the sequential pipeline */
  readonly name: string;
  /** Agents to run in sequence (accepts agents with any tool configuration) */
  readonly agents: readonly DefinedAgent[];
  /** Optional hooks for pipeline lifecycle */
  readonly hooks?: SequentialAgentHooks;
}

/**
 * Hooks for sequential agent lifecycle
 */
export interface SequentialAgentHooks {
  /** Called before each agent runs */
  beforeAgent?: (agentName: string, input: AgentInput) => Promise<void>;
  /** Called after each agent completes */
  afterAgent?: (agentName: string, result: AgentResult) => Promise<void>;
}

/**
 * Configuration for parallel agent composition
 */
export interface ParallelAgentConfig<
  TAgents extends Record<string, DefinedAgent>,
  TOutput = { [K in keyof TAgents]: string },
> {
  /** Unique name for the parallel execution */
  readonly name: string;
  /** Agents to run in parallel, keyed by name for type-safe access */
  readonly agents: TAgents;
  /** Optional hooks for parallel execution lifecycle */
  readonly hooks?: ParallelAgentHooks;
  /** Optional aggregator to combine results into custom output */
  readonly aggregate?: (results: {
    [K in keyof TAgents]: AgentResult;
  }) => TOutput;
}

/**
 * Hooks for parallel agent lifecycle
 */
export interface ParallelAgentHooks {
  /** Called before each agent runs */
  beforeAgent?: (agentName: string, input: AgentInput) => Promise<void>;
  /** Called after each agent completes */
  afterAgent?: (agentName: string, result: AgentResult) => Promise<void>;
}

/**
 * Result from a parallel agent execution
 */
export interface ParallelResult<
  TAgents extends Record<string, DefinedAgent>,
  TOutput = { [K in keyof TAgents]: string },
> {
  /** Aggregated or default output */
  readonly output: TOutput;
  /** Full results from each agent, keyed by agent name */
  readonly results: { [K in keyof TAgents]: AgentResult };
  /** Overall status */
  readonly status: "completed" | "partial" | "failed";
  /** Total iterations across all agents */
  readonly iterations: number;
  /** All tool calls from all agents */
  readonly toolCalls: readonly ToolCallRecord[];
  /** All messages from all agents */
  readonly messages: readonly Message[];
}

/**
 * Handle for a parallel agent
 */
export interface ParallelAgent<
  TAgents extends Record<string, DefinedAgent>,
  TOutput = { [K in keyof TAgents]: string },
> {
  /** Pipeline name */
  readonly name: string;
  /** Run the parallel agent with given input */
  run(input: AgentInput): Promise<ParallelAgentRunHandle<TAgents, TOutput>>;
}

/**
 * Handle for a running parallel agent
 */
export interface ParallelAgentRunHandle<
  TAgents extends Record<string, DefinedAgent>,
  TOutput = { [K in keyof TAgents]: string },
> {
  /** Unique identifier for this run */
  readonly id: string;
  /** Wait for and return the result */
  result(): Promise<ParallelResult<TAgents, TOutput>>;
  /** Cancel the running agent */
  cancel(): Promise<void>;
}
