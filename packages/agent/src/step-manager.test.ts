import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DurableBackend } from "@durable-agent/core";
import { StepManager, createStepManager } from "./step-manager.js";

function createMockBackend(): DurableBackend {
  return {
    runStep: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) as DurableBackend["runStep"],
    sleep: vi.fn(async () => undefined),
  };
}

describe("StepManager", () => {
  let backend: DurableBackend;
  let stepManager: StepManager;

  beforeEach(() => {
    backend = createMockBackend();
    stepManager = new StepManager(backend);
  });

  describe("run", () => {
    it("executes the function through the backend", async () => {
      const result = await stepManager.run("fetch-user", async () => ({
        id: 1,
        name: "Test",
      }));

      expect(result).toEqual({ id: 1, name: "Test" });
      expect(backend.runStep).toHaveBeenCalledTimes(1);
    });

    it("generates unique step names", async () => {
      await stepManager.run("step", async () => 1);
      await stepManager.run("step", async () => 2);
      await stepManager.run("step", async () => 3);

      expect(backend.runStep).toHaveBeenNthCalledWith(1, "step", expect.any(Function));
      expect(backend.runStep).toHaveBeenNthCalledWith(2, "step-1", expect.any(Function));
      expect(backend.runStep).toHaveBeenNthCalledWith(3, "step-2", expect.any(Function));
    });

    it("tracks different step names separately", async () => {
      await stepManager.run("a", async () => 1);
      await stepManager.run("b", async () => 2);
      await stepManager.run("a", async () => 3);

      expect(backend.runStep).toHaveBeenNthCalledWith(1, "a", expect.any(Function));
      expect(backend.runStep).toHaveBeenNthCalledWith(2, "b", expect.any(Function));
      expect(backend.runStep).toHaveBeenNthCalledWith(3, "a-1", expect.any(Function));
    });

    it("propagates errors from the function", async () => {
      const error = new Error("Test error");

      await expect(
        stepManager.run("failing", async () => {
          throw error;
        })
      ).rejects.toThrow("Test error");
    });
  });

  describe("sleep", () => {
    it("calls backend sleep with generated name", async () => {
      await stepManager.sleep("1h");

      expect(backend.sleep).toHaveBeenCalledWith("sleep", "1h");
    });

    it("generates unique sleep names", async () => {
      await stepManager.sleep("1h");
      await stepManager.sleep("30m");

      expect(backend.sleep).toHaveBeenNthCalledWith(1, "sleep", "1h");
      expect(backend.sleep).toHaveBeenNthCalledWith(2, "sleep-1", "30m");
    });
  });

  describe("checkpoint", () => {
    it("stores checkpoint data through run", async () => {
      const data = { progress: 50, status: "processing" };
      const result = await stepManager.checkpoint("progress", data);

      expect(result).toEqual(data);
      expect(backend.runStep).toHaveBeenCalledWith(
        "checkpoint-progress",
        expect.any(Function)
      );
    });
  });

  describe("getExecutedSteps", () => {
    it("returns list of executed step names", async () => {
      await stepManager.run("step-a", async () => 1);
      await stepManager.run("step-b", async () => 2);
      await stepManager.sleep("1h");

      const steps = stepManager.getExecutedSteps();

      expect(steps).toContain("step-a");
      expect(steps).toContain("step-b");
      expect(steps).toContain("sleep");
    });

    it("returns empty array when no steps executed", () => {
      expect(stepManager.getExecutedSteps()).toEqual([]);
    });
  });

  describe("getContext", () => {
    it("returns a DurableStepContext interface", async () => {
      const context = stepManager.getContext();

      expect(context.run).toBeDefined();
      expect(context.sleep).toBeDefined();

      await context.run("test", async () => "result");
      expect(backend.runStep).toHaveBeenCalledWith("test", expect.any(Function));

      await context.sleep("5m");
      expect(backend.sleep).toHaveBeenCalledWith("sleep", "5m");
    });
  });

  describe("reset", () => {
    it("clears step counter and executed steps", async () => {
      await stepManager.run("step", async () => 1);
      await stepManager.run("step", async () => 2);

      stepManager.reset();

      await stepManager.run("step", async () => 3);

      // Should start fresh, so step name should be "step" again
      expect(backend.runStep).toHaveBeenLastCalledWith("step", expect.any(Function));
      expect(stepManager.getExecutedSteps()).toEqual(["step"]);
    });
  });
});

describe("createStepManager", () => {
  it("creates a StepManager instance", () => {
    const backend = createMockBackend();
    const manager = createStepManager(backend);

    expect(manager).toBeInstanceOf(StepManager);
  });
});
