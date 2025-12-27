# @durable-agent/agent

Build AI agents that survive crashes. Durable Agent combines [OpenWorkflow](https://github.com/openworkflow/openworkflow) for persistence with [Vercel AI SDK](https://sdk.vercel.ai/) for LLM interactions.

## Why Durable Agent?

AI agents can run for minutes or hours. If your server restarts mid-execution, you lose everything. Durable Agent solves this:

- **Survives crashes** - Agent state is persisted to PostgreSQL. Restart your server and agents resume exactly where they left off.
- **No duplicate work** - Completed steps are skipped on recovery. LLM calls, tool executions, and sub-agents don't re-run.
- **Automatic retries** - Failed steps retry with exponential backoff.
- **Composable** - Chain agents sequentially or run them in parallel.

## Installation

```bash
# npm
npm install @durable-agent/agent openworkflow ai @ai-sdk/openai

# pnpm
pnpm add @durable-agent/agent openworkflow ai @ai-sdk/openai

# yarn
yarn add @durable-agent/agent openworkflow ai @ai-sdk/openai
```

Choose a backend:

```bash
# PostgreSQL (recommended for production)
npm install @openworkflow/backend-postgres

# pnpm
pnpm add @openworkflow/backend-postgres

# yarn
yarn add @openworkflow/backend-postgres

# SQLite (great for development and single-server deployments)
npm install @openworkflow/backend-sqlite

# pnpm
pnpm add @openworkflow/backend-sqlite

# yarn
yarn add @openworkflow/backend-sqlite
```

## Quick Start

```typescript
import { DurableAgent, tool } from "@durable-agent/agent";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// Choose your backend:

// PostgreSQL
import { BackendPostgres } from "@openworkflow/backend-postgres";
const backend = await BackendPostgres.connect(process.env.DATABASE_URL);

// Or SQLite
// import { BackendSqlite } from "@openworkflow/backend-sqlite";
// const backend = await BackendSqlite.connect("./durable-agent.db");

// Create a durable agent instance
const durableAgent = new DurableAgent({
  backend,
  model: openai("gpt-4o"),
  concurrency: 10,
});

// Define an agent with tools
const researcher = durableAgent.defineAgent({
  name: "researcher",
  system: "You are a research assistant. Use the search tool to find information.",
  tools: {
    search: tool({
      description: "Search for information on a topic",
      parameters: z.object({
        query: z.string(),
      }),
      execute: async ({ query }, ctx) => {
        // ctx.step.run makes this durable - won't re-run on recovery
        return ctx.step.run(`search:${query}`, async () => {
          const results = await searchAPI(query);
          return results;
        });
      },
    }),
  },
  maxIterations: 10,
});

// Start the worker
await durableAgent.start();

// Run the agent
const handle = await researcher.run({
  task: "Research the latest developments in AI agents",
});

// Wait for the result
const result = await handle.result();
console.log(result.output);

// Cleanup
await durableAgent.stop();
```

## Sequential Agents

Chain multiple agents together. Each agent's output becomes context for the next.

```typescript
const researcher = durableAgent.defineAgent({
  name: "researcher",
  system: "Research the given topic and provide key findings.",
  tools: { /* ... */ },
});

const writer = durableAgent.defineAgent({
  name: "writer",
  system: "Write a blog post based on the research provided.",
  tools: { /* ... */ },
});

const editor = durableAgent.defineAgent({
  name: "editor",
  system: "Review and improve the blog post.",
  tools: { /* ... */ },
});

// Create a sequential pipeline
const pipeline = durableAgent.sequentialAgent({
  name: "blog-pipeline",
  agents: [researcher, writer, editor],
  hooks: {
    beforeAgent: async (name, input) => {
      console.log(`Starting ${name}...`);
    },
    afterAgent: async (name, result) => {
      console.log(`${name} completed: ${result.status}`);
    },
  },
});

const handle = await pipeline.run({
  task: "Write a blog post about AI agents in 2025",
});

const result = await handle.result();
```

If your server crashes after the researcher completes, recovery will skip the researcher and resume from the writer.

## Parallel Agents

Run multiple agents concurrently with type-safe results.

```typescript
const webSearcher = durableAgent.defineAgent({
  name: "web-searcher",
  system: "Search the web for information.",
  tools: { /* ... */ },
});

const academicSearcher = durableAgent.defineAgent({
  name: "academic-searcher",
  system: "Search academic papers.",
  tools: { /* ... */ },
});

const industrySearcher = durableAgent.defineAgent({
  name: "industry-searcher",
  system: "Search industry reports.",
  tools: { /* ... */ },
});

// Run agents in parallel with aggregation
const research = durableAgent.parallel({
  name: "multi-source-research",
  agents: {
    web: webSearcher,
    academic: academicSearcher,
    industry: industrySearcher,
  },
  aggregate: (results) => ({
    // Full type safety - results.web, results.academic, results.industry
    summary: `Found ${Object.keys(results).length} sources`,
    webFindings: results.web.output,
    academicFindings: results.academic.output,
    industryFindings: results.industry.output,
  }),
});

const handle = await research.run({
  task: "Research AI agent frameworks",
});

const result = await handle.result();
// result.output is typed based on your aggregate function
// result.results gives you full AgentResult for each agent
```

## Durable Tools

Make any operation durable with `ctx.step.run`:

```typescript
const agent = durableAgent.defineAgent({
  name: "processor",
  tools: {
    processData: tool({
      description: "Process data with external API",
      parameters: z.object({ data: z.string() }),
      execute: async ({ data }, ctx) => {
        // Each step is persisted - won't re-run on recovery
        const validated = await ctx.step.run("validate", async () => {
          return validateData(data);
        });

        const enriched = await ctx.step.run("enrich", async () => {
          return enrichWithAPI(validated);
        });

        const saved = await ctx.step.run("save", async () => {
          return saveToDatabase(enriched);
        });

        return saved;
      },
    }),
  },
});
```

## API Reference

### `DurableAgent`

Main class for creating durable agents.

```typescript
const durableAgent = new DurableAgent({
  backend: Backend,        // OpenWorkflow backend (PostgreSQL)
  model: LanguageModel,    // AI SDK model
  concurrency?: number,    // Worker concurrency (default: 1)
});
```

### `defineAgent(config)`

Define a single agent.

```typescript
durableAgent.defineAgent({
  name: string,                    // Unique agent name
  system?: string,                 // System prompt
  tools?: ToolRegistry,            // Available tools
  maxIterations?: number,          // Max tool call loops (default: 10)
  maxTokens?: number,              // Max tokens per LLM call
  hooks?: {
    beforeToolCall?: (name, args, ctx) => Promise<void>,
    afterToolCall?: (name, result, ctx) => Promise<void>,
    onError?: (error, ctx) => Promise<"retry" | "continue" | "stop">,
  },
});
```

### `sequentialAgent(config)`

Compose agents to run in sequence.

```typescript
durableAgent.sequentialAgent({
  name: string,                    // Pipeline name
  agents: DefinedAgent[],          // Agents to run in order
  hooks?: {
    beforeAgent?: (name, input) => Promise<void>,
    afterAgent?: (name, result) => Promise<void>,
  },
});
```

### `parallel(config)`

Compose agents to run in parallel.

```typescript
durableAgent.parallel({
  name: string,                              // Pipeline name
  agents: Record<string, DefinedAgent>,      // Agents keyed by name
  aggregate?: (results) => TOutput,          // Optional result aggregator
  hooks?: {
    beforeAgent?: (name, input) => Promise<void>,
    afterAgent?: (name, result) => Promise<void>,
  },
});
```

### `tool(config)`

Define a tool for agents.

```typescript
tool({
  description: string,             // Tool description for LLM
  parameters: ZodSchema,           // Zod schema for parameters
  execute: (params, ctx) => Promise<any>,
});
```

The `ctx` object provides:
- `ctx.step.run(name, fn)` - Run a durable step
- `ctx.step.sleep(name, duration)` - Durable sleep (e.g., "1h", "30m")

## Requirements

- Node.js 18+
- SQLite or PostgreSQL
- OpenAI API key (or other AI SDK compatible provider)

## Database Setup

**SQLite** (zero config):

```typescript
import { BackendSqlite } from "@openworkflow/backend-sqlite";
const backend = await BackendSqlite.connect("./durable-agent.db");
// Tables are auto-created
```

**PostgreSQL**:

```bash
# Create the database
createdb durable_agent
```

```typescript
import { BackendPostgres } from "@openworkflow/backend-postgres";
const backend = await BackendPostgres.connect("postgresql://localhost:5432/durable_agent");
// Tables are auto-created on first run
```

## Contributing

Contributions are welcome! Here's how to get started:

### Setup

```bash
# Clone the repo
git clone https://github.com/chigala/durable-agent.git
cd durable-agent

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Project Structure

```
packages/
  core/       # Types and utilities
  agent/      # Main implementation
apps/
  playground/ # Examples and testing
```

### Development Workflow

1. Create a branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run tests: `pnpm test`
4. Run type check: `pnpm typecheck`
5. Submit a PR

### Running Examples

```bash
cd apps/playground

# Sequential agent durability test
pnpm sequential

# Parallel agent test
pnpm parallel

# Error retry test
pnpm retry

# Blog pipeline example
pnpm blog
```

### Guidelines

- Write tests for new features
- Keep the API surface minimal
- Maintain backwards compatibility
- Update documentation for user-facing changes

## License

MIT
