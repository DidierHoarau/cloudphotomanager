import { PromisePool } from "./PromisePool";

describe("PromisePool", () => {
  describe("constructor", () => {
    it("should set maxConcurrency", () => {
      const pool = new PromisePool(3);
      expect(pool.getAvailableSlots()).toBe(3);
    });

    it("should start with zero concurrency and empty queue", () => {
      const pool = new PromisePool(5);
      expect(pool.getCurrentConcurrency()).toBe(0);
      expect(pool.getQueueLength()).toBe(0);
    });
  });

  describe("add", () => {
    it("should execute a single task and resolve with its result", async () => {
      const pool = new PromisePool(2);
      const result = await pool.add(async () => "success");
      expect(result).toBe("success");
    });

    it("should execute multiple tasks concurrently up to maxConcurrency", async () => {
      const pool = new PromisePool(2);
      let concurrentExecutions = 0;
      let maxSeenConcurrency = 0;

      const tasks = Array.from({ length: 4 }, (_, i) =>
        pool.add(async () => {
          concurrentExecutions++;
          maxSeenConcurrency = Math.max(
            maxSeenConcurrency,
            concurrentExecutions,
          );
          // Simulate async work
          await new Promise((resolve) => setImmediate(resolve));
          concurrentExecutions--;
          return `task-${i}`;
        }),
      );

      const results = await Promise.all(tasks);
      expect(results).toEqual(["task-0", "task-1", "task-2", "task-3"]);
      // Max concurrency should never exceed limit
      expect(maxSeenConcurrency).toBeLessThanOrEqual(2);
    });

    it("should handle task rejection", async () => {
      const pool = new PromisePool(1);
      await expect(
        pool.add(async () => {
          throw new Error("task failed");
        }),
      ).rejects.toThrow("task failed");
    });

    it("should continue executing remaining tasks after a rejection", async () => {
      const pool = new PromisePool(2);
      const results: string[] = [];

      const task1 = pool.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("fail");
      });

      const task2 = pool.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push("ok");
        return "ok";
      });

      await expect(task1).rejects.toThrow("fail");
      await task2;
      expect(results).toEqual(["ok"]);
    });

    it("should enforce timeout", async () => {
      const pool = new PromisePool(1, 50); // 50ms timeout
      await expect(
        pool.add(async (_signal) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "too late";
        }),
      ).rejects.toThrow("Promise cancelled due to timeout");
    });

    it("should make AbortSignal available to the task", async () => {
      const pool = new PromisePool(1, 1000);
      let gotSignal = false;
      await pool.add(async (signal) => {
        gotSignal = signal instanceof AbortSignal;
        return "done";
      });
      expect(gotSignal).toBe(true);
    });
  });

  describe("getAvailableSlots", () => {
    it("should return correct available slots during execution", async () => {
      const pool = new PromisePool(3);
      expect(pool.getAvailableSlots()).toBe(3);

      // Use a promise that we can track externally
      let resolveTask;
      const taskPromise = new Promise<void>((resolve) => {
        resolveTask = resolve;
      });

      const task = pool.add(async () => {
        await taskPromise;
        return "done";
      });

      // Give the microtask queue a chance to process the runNext() call
      await new Promise((resolve) => process.nextTick(resolve));
      expect(pool.getAvailableSlots()).toBe(2);
      expect(pool.getCurrentConcurrency()).toBe(1);

      resolveTask();
      await task;
      expect(pool.getAvailableSlots()).toBe(3);
      expect(pool.getCurrentConcurrency()).toBe(0);
    });
  });
});
