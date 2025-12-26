import type { Message, ToolCall } from "./message.js";
import type { ToolRegistry } from "./tool.js";

/**
 * Options for model generation
 * Used internally by strategies
 */
export interface GenerateOptions {
  /** Messages to send to the model */
  readonly messages: readonly Message[];
  /** Tools available to the model */
  readonly tools?: ToolRegistry;
  /** System prompt (alternative to system message) */
  readonly system?: string;
  /** Maximum tokens to generate */
  readonly maxTokens?: number;
  /** Temperature for sampling */
  readonly temperature?: number;
  /** Stop sequences */
  readonly stopSequences?: readonly string[];
}

/**
 * Response from model generation
 * Used internally by strategies
 */
export interface GenerateResponse {
  /** Generated text content */
  readonly text: string;
  /** Tool calls requested by the model */
  readonly toolCalls: readonly ToolCall[];
  /** Reason the model stopped generating */
  readonly finishReason: "stop" | "tool-calls" | "length" | "content-filter";
  /** Token usage statistics */
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/**
 * Interface for language model adapters
 * Used internally by strategies
 */
export interface LanguageModelAdapter {
  /** Model identifier */
  readonly modelId: string;

  /**
   * Generate a response from the model
   */
  generate(options: GenerateOptions): Promise<GenerateResponse>;
}
