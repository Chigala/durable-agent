/**
 * Sleep Server Example
 *
 * Demonstrates how to use durable tools with sleep in an Express server.
 * The workflow properly pauses during sleep and resumes after the duration.
 *
 * Run with: pnpm --filter @durable-agent/playground server
 *
 * API Endpoints:
 *   POST /agent/run         - Start a new agent run (returns runId immediately)
 *   GET  /agent/:id/status  - Check status (non-blocking)
 *   GET  /agent/:id/result  - Wait for result (blocking)
 *   POST /agent/:id/cancel  - Cancel a running agent
 */

import "dotenv/config";
import express, { Request, Response } from "express";
import { DurableAgent, tool } from "@durable-agent/agent";
import { BackendPostgres } from "@openworkflow/backend-postgres";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let durableAgent: DurableAgent;
let researcher: ReturnType<DurableAgent["defineAgent"]>;
let summarizer: ReturnType<DurableAgent["defineAgent"]>;
let sequentialPipeline: ReturnType<DurableAgent["sequentialAgent"]>;

async function initDurableAgent() {
  const backend = await BackendPostgres.connect(process.env.DATABASE_URL || "");

  durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o"),
    concurrency: 10,
  });

  researcher = durableAgent.defineAgent({
    name: "researcher-sleep-example",
    system:
      "You are a helpful research assistant. Use the search tool to find information. Provide concise, informative answers based on the search results.",
    tools: {
      search: tool({
        description:
          "Search for information on a topic. This search takes time to process - results will be available after the processing completes.",
        parameters: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }, ctx) => {
          // 1. Do work BEFORE sleep (this gets cached)
          const searchId = await ctx.step.run("initiate-search", async () => {
            console.log(`[${new Date().toISOString()}] Starting search for: ${query}`);
            // Simulate starting a long-running search job
            return { id: `search-${Date.now()}`, query };
          });

          // 2. Sleep - workflow pauses here, worker released
          // Change this duration for testing (e.g., "10s", "1m", "1h")
          await ctx.step.sleep("2m");

          // 3. Do work AFTER sleep (this runs when resumed)
          const results = await ctx.step.run("get-results", async () => {
            console.log(`[${new Date().toISOString()}] Getting results for search: ${searchId.id}`);
            // Simulate fetching results after the wait
            return {
              query: searchId.query,
              results: [
                `Result 1 for "${searchId.query}": This is the first finding from our comprehensive search.`,
                `Result 2 for "${searchId.query}": Here is additional relevant information discovered.`,
                `Result 3 for "${searchId.query}": Final insight from the search results.`,
              ],
            };
          });

          // 4. Return meaningful result to LLM
          return `Search completed for "${results.query}":\n\n${results.results.join("\n\n")}`;
        },
      }),
    },
    maxIterations: 10,
  });

  // Define a summarizer agent with a tool that also sleeps
  summarizer = durableAgent.defineAgent({
    name: "summarizer-sleep-example",
    system:
      "You are a summarization expert. Use the summarize tool to process and summarize the research provided.",
    tools: {
      summarize: tool({
        description: "Process and summarize research content. Takes a short time to analyze.",
        parameters: z.object({
          content: z.string().describe("The content to summarize"),
        }),
        execute: async ({ content }, ctx) => {
          // 1. Start processing
          const processId = await ctx.step.run("start-summary", async () => {
            console.log(`[${new Date().toISOString()}] Starting summarization...`);
            return { id: `summary-${Date.now()}`, contentLength: content.length };
          });

          // 2. Short sleep (30 seconds)
          await ctx.step.sleep("1m");

          // 3. Return processed summary
          const result = await ctx.step.run("finish-summary", async () => {
            console.log(`[${new Date().toISOString()}] Summarization complete for ${processId.id}`);
            return `Summary of ${processId.contentLength} characters:\n\n${content.slice(0, 200)}...\n\n[Processed after 2m delay]`;
          });

          return result;
        },
      }),
    },
    maxIterations: 10,
  });

  // Define a sequential pipeline: researcher -> summarizer
  // The researcher will sleep, then the summarizer will process the results
  sequentialPipeline = durableAgent.sequentialAgent({
    name: "research-and-summarize-pipeline",
    agents: [researcher, summarizer],
  });

  await durableAgent.start();
  console.log("Durable Agent started");
}

app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Durable Agent Sleep Example Server",
    endpoints: {
      "POST /agent/run": "Start a single agent run",
      "POST /sequential/run": "Start sequential pipeline (researcher -> summarizer)",
      "GET /agent/:id/status": "Check status (non-blocking)",
      "GET /agent/:id/result": "Wait for result (blocking)",
      "POST /agent/:id/cancel": "Cancel a running agent",
    },
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start single agent - returns immediately with runId
app.post("/agent/run", async (req: Request, res: Response) => {
  try {
    const { task } = req.body;

    if (!task) {
      res.status(400).json({ error: "Task is required" });
      return;
    }

    console.log(`[${new Date().toISOString()}] Starting agent with task: ${task}`);
    const handle = await researcher.run({ task });

    // Return immediately - don't wait for result!
    res.json({
      runId: handle.id,
      message: "Agent started. Use /agent/:id/status to check progress.",
    });
  } catch (error) {
    console.error("Agent error:", error);
    res.status(500).json({ error: "Agent execution failed" });
  }
});

// Start sequential pipeline - returns immediately with runId
// Pipeline: researcher (with sleep) -> summarizer
app.post("/sequential/run", async (req: Request, res: Response) => {
  try {
    const { task } = req.body;

    if (!task) {
      res.status(400).json({ error: "Task is required" });
      return;
    }

    console.log(`[${new Date().toISOString()}] Starting sequential pipeline with task: ${task}`);
    const handle = await sequentialPipeline.run({ task });

    // Return immediately - don't wait for result!
    res.json({
      runId: handle.id,
      message: "Sequential pipeline started (researcher -> summarizer). Use /agent/:id/status to check progress.",
    });
  } catch (error) {
    console.error("Sequential pipeline error:", error);
    res.status(500).json({ error: "Sequential pipeline execution failed" });
  }
});

// Check status - non-blocking
app.get("/agent/:id/status", async (req: Request, res: Response) => {
  try {
    const handle = durableAgent.getHandle(req.params.id || "");
    const description = await handle.describe();
    console.log("Description:", description);

    res.json({
      runId: req.params.id,
      state: description.state,
      availableAt: description.availableAt,
      startedAt: description.startedAt,
      completedAt: description.completedAt,
      error: description.error,
      // Only include output if completed
      ...(description.state === "completed" && { output: description.output }),
    });
  } catch (error) {
    console.error("Status error:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Get result - blocking (waits for completion)
app.get("/agent/:id/result", async (req: Request, res: Response) => {
  try {
    const handle = durableAgent.getHandle(req.params.id || "");

    // This blocks until complete - use with caution!
    const result = await handle.result();

    res.json({
      status: result.status,
      output: result.output,
      iterations: result.iterations,
    });
  } catch (error) {
    console.error("Result error:", error);
    res.status(500).json({ error: "Failed to get result" });
  }
});

// Cancel a running agent
app.post("/agent/:id/cancel", async (req: Request, res: Response) => {
  try {
    const handle = durableAgent.getHandle(req.params.id || "");
    await handle.cancel();
    res.json({ message: "Agent cancelled" });
  } catch (error) {
    console.error("Cancel error:", error);
    res.status(500).json({ error: "Failed to cancel" });
  }
});

async function main() {
  await initDurableAgent();

  app.listen(PORT, () => {
    console.log(`
========================================
  Durable Agent Sleep Example Server
========================================

Server running at: http://localhost:${PORT}

Single agent test:
  curl -X POST http://localhost:${PORT}/agent/run \\
    -H "Content-Type: application/json" \\
    -d '{"task": "Search for information about TypeScript"}'

Sequential pipeline test (researcher -> summarizer):
  curl -X POST http://localhost:${PORT}/sequential/run \\
    -H "Content-Type: application/json" \\
    -d '{"task": "Research the benefits of TypeScript"}'

Check status:
  curl http://localhost:${PORT}/agent/<runId>/status

Note: The search tool sleeps for 2 minutes. Watch the logs!
========================================
`);
  });
}

main().catch(console.error);

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  if (durableAgent) {
    await durableAgent.stop();
  }
  process.exit(0);
});
