/**
 * Represents a tool call made by the model
 */
export interface ToolCall {
  /** Unique identifier for this tool call */
  readonly toolCallId: string;
  /** Name of the tool to call */
  readonly toolName: string;
  /** Arguments for the tool */
  readonly args: Record<string, unknown>;
}

/**
 * Result from a tool execution
 */
export interface ToolResult {
  /** ID of the tool call this is a result for */
  readonly toolCallId: string;
  /** Name of the tool */
  readonly toolName: string;
  /** Serialized result from the tool */
  readonly result: string;
  /** Whether the tool execution failed */
  readonly isError?: boolean;
}

/**
 * System message in a conversation
 */
export interface SystemMessage {
  readonly role: "system";
  readonly content: string;
}

/**
 * User message in a conversation
 */
export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

/**
 * Assistant message in a conversation
 */
export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
}

/**
 * Tool result message in a conversation
 */
export interface ToolMessage {
  readonly role: "tool";
  readonly content: readonly ToolResult[];
}

/**
 * Union of all message types
 */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/**
 * Conversation history
 */
export type MessageHistory = readonly Message[];
