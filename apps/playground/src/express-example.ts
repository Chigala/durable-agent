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

async function initDurableAgent() {
  const backend = await BackendPostgres.connect(process.env.DATABASE_URL || "");

  durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o"),
    concurrency: 10,
  });

  researcher = durableAgent.defineAgent({
    name: "olaedo-v5-sleep",
    system:
      "You are a helpful research assistant. Provide concise, informative answers.",
    tools: {
      search: tool({
        description:
          "Search for information on a topic (takes ~1 hour to process)",
        parameters: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }, ctx) => {
          // 1. Do work BEFORE sleep (this gets cached)
          const searchId = await ctx.step.run("initiate-search", async () => {
            console.log(`Starting search for: ${query}`);
            // Simulate starting a long-running search job
            return { id: `search-${Date.now()}`, query };
          });

          // 2. Sleep - workflow pauses here, worker released
          await ctx.step.sleep("5m");

          // 3. Do work AFTER sleep (this runs when resumed)
          const results = await ctx.step.run("get-results", async () => {
            console.log(`Getting results for search: ${searchId.id}`);
            // Simulate fetching results after the wait
            return {
              query: searchId.query,
              results: [
                `Result 1 for "${searchId.query}"`,
                `Result 2 for "${searchId.query}"`,
                `Result 3 for "${searchId.query}"`,
              ],
            };
          });

          // 4. Return meaningful result to LLM
          return `Search results for "${
            results.query
          }":\n${results.results.join("\n")}`;
        },
      }),
    },
    maxIterations: 5,
  });

  await durableAgent.start();
  console.log("Durable Agent started");
}

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Durable Agent Express App" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start agent - returns immediately with runId
app.post("/agent/run", async (req: Request, res: Response) => {
  try {
    const { task } = req.body;

    if (!task) {
      res.status(400).json({ error: "Task is required" });
      return;
    }

    const handle = await researcher.run({ task });

    console.log("this is the json: ", JSON.stringify(handle, null, 2));

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

// Check status - non-blocking
app.get("/agent/:id/status", async (req: Request, res: Response) => {
  try {
    const handle = durableAgent.getHandle(req.params.id || "");
    const description = await handle.describe();

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
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  if (durableAgent) {
    await durableAgent.stop();
  }
  process.exit(0);
});
