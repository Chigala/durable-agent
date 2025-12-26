// Main entry point - DurableAgent
export {
  DurableAgent,
  createDurableAgent,
  type DurableAgentConfig,
  type DefinedAgent,
  type AgentRunHandle,
} from "./durable-agent.js";

// Re-export core types
export type {
  // Tool types
  ToolContext,
  DurableStepContext,
  ToolDefinition,
  ToolExecuteFn,
  ToolRegistry,
  ToolParams,
  ToolResults,
  ToolCallRecord,
  // Message types
  ToolCall,
  ToolResult,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  Message,
  MessageHistory,
  // Agent types
  AgentStrategy,
  AgentInput,
  AgentResult,
  AgentHooks,
  AgentConfig,
} from "@durable-agent/core";

// Re-export core utilities
export { tool } from "@durable-agent/core";
