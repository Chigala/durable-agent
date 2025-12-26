import type {
  AgentContext,
  AgentResult,
  AgentHooks,
  ModelResponse,
  ToolCall,
  ToolResult,
  ToolRegistry,
  LanguageModelAdapter,
} from "@durable-agent/core";

/**
 * Options passed to strategy execution
 */
export interface StrategyOptions<TTools extends ToolRegistry = ToolRegistry> {
  /** Language model to use for generation */
  model: LanguageModelAdapter;
  /** Maximum iterations before stopping */
  maxIterations: number;
  /** System prompt */
  system?: string;
  /** Lifecycle hooks */
  hooks?: AgentHooks<TTools>;
}

/**
 * Functions available to strategies for execution
 */
export interface StrategyExecutionFunctions<
  TTools extends ToolRegistry = ToolRegistry,
> {
  /** Generate a response from the model */
  generateResponse(context: AgentContext<TTools>): Promise<ModelResponse>;
  /** Execute tool calls */
  executeTools(
    toolCalls: readonly ToolCall[],
    context: AgentContext<TTools>
  ): Promise<readonly ToolResult[]>;
}

/**
 * Interface for agent execution strategies
 */
export interface AgentExecutionStrategy<
  TTools extends ToolRegistry = ToolRegistry,
> {
  /** Strategy name */
  readonly name: string;

  /**
   * Execute the agent strategy
   *
   * @param context - Agent execution context
   * @param options - Strategy options
   * @param fns - Execution functions
   * @returns Agent execution result
   */
  execute(
    context: AgentContext<TTools>,
    options: StrategyOptions<TTools>,
    fns: StrategyExecutionFunctions<TTools>
  ): Promise<AgentResult>;
}
