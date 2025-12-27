/**
 * Blog Post Generation Pipeline
 *
 * A production-ready sequential agent pipeline that:
 * 1. Researcher - Gathers information and key points on a topic
 * 2. Writer - Creates a draft blog post from research
 * 3. Editor - Reviews and improves the draft
 * 4. SEO Optimizer - Adds metadata, keywords, and optimizations
 *
 * This demonstrates a real-world content creation workflow where each
 * agent builds on the previous agent's output.
 *
 * Usage:
 *   pnpm blog "Your blog topic here"
 *   pnpm blog "The Future of AI Agents in Enterprise Software"
 */

import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { BackendPostgres } from "@openworkflow/backend-postgres";
import { z } from "zod";
import { DurableAgent, tool } from "@durable-agent/agent";

if (!process.env.OPENAI_API_KEY) {
  console.error("Please set OPENAI_API_KEY in apps/playground/.env");
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/durable_agent";

// Get topic from command line args
const TOPIC = process.argv[2] ?? "The Rise of AI Agents in 2025";
const WORKFLOW_ID = `blog-${Date.now()}`;

// Shared state to collect outputs from each stage
interface PipelineState {
  research?: ResearchOutput;
  draft?: DraftOutput;
  editedDraft?: EditedOutput;
  finalPost?: SEOOutput;
}

interface ResearchOutput {
  topic: string;
  keyPoints: string[];
  statistics: string[];
  quotes: string[];
  targetAudience: string;
}

interface DraftOutput {
  title: string;
  content: string;
  wordCount: number;
}

interface EditedOutput {
  title: string;
  content: string;
  wordCount: number;
  changesApplied: string[];
}

interface SEOOutput {
  title: string;
  metaDescription: string;
  keywords: string[];
  content: string;
  readingTime: string;
  slug: string;
}

const pipelineState: PipelineState = {};

function log(msg: string) {
  const ts = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  BLOG POST GENERATION PIPELINE");
  console.log("=".repeat(70));
  console.log(`\n  Topic: "${TOPIC}"`);
  console.log(`  Workflow ID: ${WORKFLOW_ID}`);
  console.log("\n  Pipeline: Researcher → Writer → Editor → SEO Optimizer");
  console.log("\n" + "-".repeat(70) + "\n");

  log("Connecting to PostgreSQL...");
  const backend = await BackendPostgres.connect(DATABASE_URL);
  log("Connected!\n");

  const durableAgent = new DurableAgent({
    backend,
    model: openai("gpt-4o-mini"),
    concurrency: 10,
  });

  // ============================================================================
  // AGENT 1: Researcher
  // ============================================================================
  const researcher = durableAgent.defineAgent({
    name: `researcher-${WORKFLOW_ID}`,
    system: `You are a research specialist. Your ONLY job is to gather raw research data.

IMPORTANT INSTRUCTIONS:
1. Call the research tool ONCE with the topic and target audience
2. After receiving the tool result, respond with a brief summary like "Research complete. Found X key points."
3. Do NOT write blog content - just gather data for the next agent
4. Do NOT call the tool more than once`,
    tools: {
      research: tool({
        description: "Research a topic and compile key information for a blog post",
        parameters: z.object({
          topic: z.string().describe("The topic to research"),
          targetAudience: z.string().describe("The intended audience for the blog"),
        }),
        execute: async ({ topic, targetAudience }, ctx) => {
          return ctx.step.run(`research:${topic.slice(0, 30)}`, async () => {
            log(`  🔍 Researching: "${topic}" for ${targetAudience}`);

            // In production, this would call real APIs (web search, databases, etc.)
            const output: ResearchOutput = {
              topic,
              targetAudience,
              keyPoints: [
                "AI agents are autonomous systems that can perform tasks independently",
                "The market for AI agents is projected to grow significantly by 2027",
                "Key capabilities include reasoning, tool use, and multi-step planning",
                "Enterprise adoption is accelerating across industries",
                "Challenges include reliability, security, and governance",
              ],
              statistics: [
                "73% of enterprises plan to adopt AI agents by 2026",
                "AI agent market expected to reach $28.5B by 2028",
                "Average productivity improvement of 40% reported",
              ],
              quotes: [
                "AI agents represent the next evolution of software automation - Industry Expert",
              ],
            };

            pipelineState.research = output;
            return output;
          });
        },
      }),
    },
    maxIterations: 5,
  });

  // ============================================================================
  // AGENT 2: Writer
  // ============================================================================
  const writer = durableAgent.defineAgent({
    name: `writer-${WORKFLOW_ID}`,
    system: `You are a professional blog writer.

IMPORTANT INSTRUCTIONS:
1. Look at the research data from the previous agent
2. Call the write_draft tool ONCE to create the blog post
3. After receiving the tool result, respond with "Draft complete. Word count: X"
4. Do NOT call the tool more than once - one draft is enough`,
    tools: {
      write_draft: tool({
        description: "Write a blog post draft based on research findings",
        parameters: z.object({
          title: z.string().describe("The blog post title"),
          keyPoints: z.array(z.string()).describe("Key points to cover"),
          statistics: z.array(z.string()).describe("Statistics to include"),
          targetAudience: z.string().describe("Who the post is for"),
        }),
        execute: async ({ title, keyPoints, statistics, targetAudience }, ctx) => {
          return ctx.step.run(`write:${title.slice(0, 30)}`, async () => {
            log(`  ✍️  Writing draft: "${title}"`);

            // Generate a structured blog post
            const sections = keyPoints.map((point, i) => {
              const stat = statistics[i] ?? "";
              return `## ${point.split(" ").slice(0, 5).join(" ")}...\n\n${point}${stat ? ` According to recent data, ${stat.toLowerCase()}.` : ""}\n`;
            });

            const content = `# ${title}

*A comprehensive guide for ${targetAudience}*

## Introduction

The landscape of artificial intelligence is rapidly evolving, and at the forefront of this evolution are AI agents. These sophisticated systems are transforming how businesses operate and how we interact with technology.

${sections.join("\n")}

## Conclusion

As we look to the future, AI agents will continue to play an increasingly important role in enterprise software and beyond. Organizations that embrace this technology early will be well-positioned to reap the benefits.

---
*Stay tuned for more insights on AI and emerging technologies.*
`;

            const output: DraftOutput = {
              title,
              content,
              wordCount: content.split(/\s+/).length,
            };

            pipelineState.draft = output;
            return output;
          });
        },
      }),
    },
    maxIterations: 5,
  });

  // ============================================================================
  // AGENT 3: Editor
  // ============================================================================
  const editor = durableAgent.defineAgent({
    name: `editor-${WORKFLOW_ID}`,
    system: `You are a professional editor for technical blog content.

IMPORTANT INSTRUCTIONS:
1. Look at the draft from the previous agent
2. Call the edit_draft tool ONCE to improve it
3. After receiving the tool result, respond with "Editing complete. Changes applied: X"
4. Do NOT call the tool more than once`,
    tools: {
      edit_draft: tool({
        description: "Review and edit a blog post draft",
        parameters: z.object({
          title: z.string().describe("The current title"),
          content: z.string().describe("The draft content to edit"),
          focusAreas: z.array(z.string()).describe("Areas to focus editing on"),
        }),
        execute: async ({ title, content, focusAreas }, ctx) => {
          return ctx.step.run(`edit:${title.slice(0, 30)}`, async () => {
            log(`  📝 Editing draft (focus: ${focusAreas.join(", ")})`);

            // In production, this would do real editing with an LLM
            const changesApplied = [
              "Improved introduction hook",
              "Added transition sentences between sections",
              "Strengthened conclusion with call-to-action",
              "Fixed grammar and punctuation",
              "Enhanced readability with shorter paragraphs",
            ];

            // Simulate edits by enhancing the content
            const editedContent = content
              .replace("## Introduction", "## Introduction\n\n> The future of work is autonomous.\n")
              .replace("Stay tuned", "📧 Subscribe to our newsletter and stay tuned");

            const output: EditedOutput = {
              title: title.includes("?") ? title : `${title}: What You Need to Know`,
              content: editedContent,
              wordCount: editedContent.split(/\s+/).length,
              changesApplied,
            };

            pipelineState.editedDraft = output;
            return output;
          });
        },
      }),
    },
    maxIterations: 5,
  });

  // ============================================================================
  // AGENT 4: SEO Optimizer
  // ============================================================================
  const seoOptimizer = durableAgent.defineAgent({
    name: `seo-${WORKFLOW_ID}`,
    system: `You are an SEO specialist for blog content.

IMPORTANT INSTRUCTIONS:
1. Look at the edited content from the previous agent
2. Call the optimize_seo tool ONCE to add SEO metadata
3. After receiving the tool result, respond with "SEO optimization complete."
4. Do NOT call the tool more than once`,
    tools: {
      optimize_seo: tool({
        description: "Optimize a blog post for SEO",
        parameters: z.object({
          title: z.string().describe("The blog post title"),
          content: z.string().describe("The blog post content"),
          primaryKeyword: z.string().describe("The main keyword to target"),
        }),
        execute: async ({ title, content, primaryKeyword }, ctx) => {
          return ctx.step.run(`seo:${primaryKeyword.slice(0, 30)}`, async () => {
            log(`  🎯 Optimizing SEO for keyword: "${primaryKeyword}"`);

            // Generate SEO metadata
            const wordCount = content.split(/\s+/).length;
            const readingTime = `${Math.ceil(wordCount / 200)} min read`;
            const slug = title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");

            const output: SEOOutput = {
              title,
              metaDescription: `Learn about ${primaryKeyword}. Discover key insights, statistics, and actionable strategies for ${new Date().getFullYear()}.`,
              keywords: [
                primaryKeyword,
                "AI agents",
                "enterprise AI",
                "automation",
                "artificial intelligence",
                "digital transformation",
              ],
              content,
              readingTime,
              slug,
            };

            pipelineState.finalPost = output;
            return output;
          });
        },
      }),
    },
    maxIterations: 5,
  });

  // ============================================================================
  // Sequential Pipeline
  // ============================================================================
  const blogPipeline = durableAgent.sequentialAgent({
    name: `blog-pipeline-${WORKFLOW_ID}`,
    agents: [researcher, writer, editor, seoOptimizer],
    hooks: {
      beforeAgent: async (name) => {
        const agentName = name.split("-")[0];
        console.log("\n" + "-".repeat(50));
        log(`🚀 Starting: ${agentName?.toUpperCase()}`);
      },
      afterAgent: async (name, result) => {
        const agentName = name.split("-")[0];
        log(`✅ Completed: ${agentName?.toUpperCase()} (${result.status})`);
      },
    },
  });

  // Start worker
  await durableAgent.start();
  log("Worker started\n");

  try {
    log(`📝 Generating blog post about: "${TOPIC}"\n`);

    const handle = await blogPipeline.run({
      task: `Topic: ${TOPIC}
Target audience: Technical professionals and enterprise decision-makers
Primary keyword for SEO: ${TOPIC}`,
    });

    log(`Run ID: ${handle.id}`);

    const result = await handle.result();

    // ========================================================================
    // Display Results
    // ========================================================================
    console.log("\n\n" + "=".repeat(70));
    console.log("  PIPELINE COMPLETE");
    console.log("=".repeat(70));
    console.log(`  Status: ${result.status}`);
    console.log(`  Total Iterations: ${result.iterations}`);
    console.log(`  Total Tool Calls: ${result.toolCalls.length}`);

    if (pipelineState.finalPost) {
      const post = pipelineState.finalPost;

      console.log("\n" + "=".repeat(70));
      console.log("  FINAL BLOG POST");
      console.log("=".repeat(70));

      console.log("\n📋 METADATA:");
      console.log("-".repeat(50));
      console.log(`  Title:       ${post.title}`);
      console.log(`  Slug:        ${post.slug}`);
      console.log(`  Reading:     ${post.readingTime}`);
      console.log(`  Keywords:    ${post.keywords.join(", ")}`);
      console.log(`  Description: ${post.metaDescription}`);

      console.log("\n📄 CONTENT:");
      console.log("-".repeat(50));
      console.log(post.content);
    }

    if (pipelineState.editedDraft?.changesApplied) {
      console.log("\n✏️  EDITOR CHANGES APPLIED:");
      console.log("-".repeat(50));
      pipelineState.editedDraft.changesApplied.forEach((change) => {
        console.log(`  • ${change}`);
      });
    }

    console.log("\n" + "=".repeat(70));
    console.log("  ✅ Blog post generated successfully!");
    console.log("=".repeat(70) + "\n");

  } finally {
    await durableAgent.stop();
    log("Worker stopped");
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
