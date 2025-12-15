/**
 * Tests for job executor with timeout support
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import { executeWithTimeout, withTimeout } from "./jobExecutor";

if (Meteor.isServer) {
  describe("jobExecutor", () => {
    describe("executeWithTimeout", () => {
      it("should execute synchronous jobs successfully", async () => {
        const result = await executeWithTimeout(
          () => "sync result",
          new Date(),
          "test-job",
        );

        expect(result.success).to.equal(true);
        expect(result.result).to.equal("sync result");
        expect(result.timedOut).to.equal(false);
        expect(result.duration).to.be.at.least(0);
      });

      it("should execute async jobs successfully", async () => {
        const result = await executeWithTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return "async result";
          },
          new Date(),
          "test-job",
        );

        expect(result.success).to.equal(true);
        expect(result.result).to.equal("async result");
        expect(result.timedOut).to.equal(false);
        expect(result.duration).to.be.at.least(20);
      });

      it("should capture job errors", async () => {
        const result = await executeWithTimeout(
          () => {
            throw new Error("Job failed");
          },
          new Date(),
          "test-job",
        );

        expect(result.success).to.equal(false);
        expect(result.timedOut).to.equal(false);
        expect(result.error).to.exist;
        expect(result.error!.message).to.match(/Job failed/);
      });

      it("should capture async job errors", async () => {
        const result = await executeWithTimeout(
          async () => {
            throw new Error("Async job failed");
          },
          new Date(),
          "test-job",
        );

        expect(result.success).to.equal(false);
        expect(result.timedOut).to.equal(false);
        expect(result.error).to.exist;
        expect(result.error!.message).to.match(/Async job failed/);
      });

      it("should pass intendedAt and jobName to job function", async () => {
        const intendedAt = new Date();
        let capturedDate: Date | undefined;
        let capturedName: string | undefined;

        await executeWithTimeout(
          (date, name) => {
            capturedDate = date;
            capturedName = name;
            return null;
          },
          intendedAt,
          "my-job",
        );

        expect(capturedDate).to.equal(intendedAt);
        expect(capturedName).to.equal("my-job");
      });

      describe("Timeout", () => {
        it("should timeout slow jobs", async () => {
          const result = await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return "should not get here";
            },
            new Date(),
            "slow-job",
            { timeout: 50 },
          );

          expect(result.success).to.equal(false);
          expect(result.timedOut).to.equal(true);
          expect(result.error).to.exist;
          expect(result.error!.message).to.match(/timed out/);
          expect(result.error!.message).to.match(/slow-job/);
          expect(result.duration).to.be.at.least(50);
        });

        it("should complete fast jobs before timeout", async () => {
          const result = await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return "fast result";
            },
            new Date(),
            "fast-job",
            { timeout: 100 },
          );

          expect(result.success).to.equal(true);
          expect(result.result).to.equal("fast result");
          expect(result.timedOut).to.equal(false);
        });

        it("should call onTimeout when job times out", async () => {
          let timeoutDuration: number | undefined;

          await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return null;
            },
            new Date(),
            "timeout-job",
            {
              timeout: 30,
              onTimeout: (duration) => {
                timeoutDuration = duration;
              },
            },
          );

          expect(timeoutDuration).to.exist;
          expect(timeoutDuration!).to.be.at.least(30);
        });

        it("should not call onTimeout when job completes normally", async () => {
          let onTimeoutCalled = false;

          await executeWithTimeout(
            async () => "quick",
            new Date(),
            "quick-job",
            {
              timeout: 100,
              onTimeout: () => {
                onTimeoutCalled = true;
              },
            },
          );

          expect(onTimeoutCalled).to.equal(false);
        });

        it("should not call onTimeout when job fails normally", async () => {
          let onTimeoutCalled = false;

          await executeWithTimeout(
            async () => {
              throw new Error("Normal failure");
            },
            new Date(),
            "failing-job",
            {
              timeout: 100,
              onTimeout: () => {
                onTimeoutCalled = true;
              },
            },
          );

          expect(onTimeoutCalled).to.equal(false);
        });

        it("should work without timeout option", async () => {
          const result = await executeWithTimeout(
            () => "no timeout",
            new Date(),
            "no-timeout-job",
          );

          expect(result.success).to.equal(true);
          expect(result.result).to.equal("no timeout");
          expect(result.timedOut).to.equal(false);
        });

        it("should work with timeout set to 0 (no timeout)", async () => {
          const result = await executeWithTimeout(
            () => "zero timeout",
            new Date(),
            "zero-timeout-job",
            { timeout: 0 },
          );

          expect(result.success).to.equal(true);
          expect(result.result).to.equal("zero timeout");
        });
      });

      describe("Duration tracking", () => {
        it("should track duration for successful jobs", async () => {
          const result = await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 30));
              return "done";
            },
            new Date(),
            "timed-job",
          );

          expect(result.duration).to.be.at.least(30);
          expect(result.duration).to.be.lessThan(100); // Sanity check
        });

        it("should track duration for failed jobs", async () => {
          const result = await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              throw new Error("Failed");
            },
            new Date(),
            "failing-timed-job",
          );

          expect(result.duration).to.be.at.least(20);
        });

        it("should track duration for timed out jobs", async () => {
          const result = await executeWithTimeout(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return null;
            },
            new Date(),
            "timeout-duration-job",
            { timeout: 40 },
          );

          expect(result.duration).to.be.at.least(40);
          expect(result.duration).to.be.lessThan(200); // Should timeout before completion
        });
      });
    });

    describe("withTimeout", () => {
      it("should create a wrapped job with timeout", async () => {
        const wrappedJob = withTimeout(async () => "wrapped result", 100);

        const result = await wrappedJob(new Date(), "wrapped-job");
        expect(result).to.equal("wrapped result");
      });

      it("should timeout wrapped jobs", async () => {
        const wrappedJob = withTimeout(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "should not get here";
        }, 30);

        try {
          await wrappedJob(new Date(), "slow-wrapped-job");
          expect.fail("Should have thrown");
        } catch (error) {
          expect((error as Error).message).to.match(/timed out/);
        }
      });

      it("should pass through job errors", async () => {
        const wrappedJob = withTimeout(async () => {
          throw new Error("Wrapped job error");
        }, 100);

        try {
          await wrappedJob(new Date(), "error-wrapped-job");
          expect.fail("Should have thrown");
        } catch (error) {
          expect((error as Error).message).to.match(/Wrapped job error/);
        }
      });

      it("should pass intendedAt and jobName to wrapped job", async () => {
        const intendedAt = new Date();
        let capturedDate: Date | undefined;
        let capturedName: string | undefined;

        const wrappedJob = withTimeout((date, name) => {
          capturedDate = date;
          capturedName = name;
          return "done";
        }, 100);

        await wrappedJob(intendedAt, "param-test");

        expect(capturedDate).to.equal(intendedAt);
        expect(capturedName).to.equal("param-test");
      });
    });
  });
}

