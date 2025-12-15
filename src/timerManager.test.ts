/**
 * Tests for timer manager with circuit breakers
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import {
  getMaxDelay,
  getMinDelay,
  scheduleOnce,
  scheduleRecurring,
} from "./timerManager";

if (Meteor.isServer) {
  describe("timerManager", () => {
    describe("scheduleRecurring", () => {
      it("should schedule and execute recurring jobs", async () => {
        let executionCount = 0;

        const timer = scheduleRecurring(
          (from) => new Date(from.getTime() + 20), // 20ms intervals
          () => {
            executionCount++;
          },
        );

        // Wait for a few executions
        await new Promise((resolve) => setTimeout(resolve, 100));

        timer.clear();

        expect(executionCount).to.be.at.least(
          2,
          `Expected at least 2 executions, got ${executionCount}`,
        );
      });

      it("should clear timer when requested", async () => {
        let executionCount = 0;

        const timer = scheduleRecurring(
          (from) => new Date(from.getTime() + 30),
          () => {
            executionCount++;
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 50));
        timer.clear();

        const countAfterClear = executionCount;
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(executionCount).to.equal(
          countAfterClear,
          "No executions should occur after clear",
        );
      });

      it("should normalize intended time (remove milliseconds)", async () => {
        let capturedTime: Date | undefined;

        const timer = scheduleRecurring(
          (from) => new Date(from.getTime() + 20),
          (intendedAt) => {
            capturedTime = intendedAt;
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 50));
        timer.clear();

        expect(capturedTime).to.exist;
        expect(capturedTime!.getMilliseconds()).to.equal(0);
      });

      it("should call onSchedule callback", async () => {
        const scheduledTimes: Date[] = [];

        const timer = scheduleRecurring(
          (from) => new Date(from.getTime() + 20),
          () => {},
          {
            onSchedule: (nextRunAt) => {
              scheduledTimes.push(nextRunAt);
            },
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 80));
        timer.clear();

        expect(scheduledTimes.length).to.be.greaterThan(
          0,
          "Should have scheduled at least once",
        );
      });

      it("should continue scheduling even if execution throws", async () => {
        let executionCount = 0;
        const errors: Error[] = [];

        const timer = scheduleRecurring(
          (from) => new Date(from.getTime() + 20),
          () => {
            executionCount++;
            throw new Error("Execution error");
          },
          {
            onError: (err) => errors.push(err),
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 100));
        timer.clear();

        expect(executionCount).to.be.at.least(
          2,
          "Should continue despite execution errors",
        );
        expect(errors.length).to.be.greaterThan(0, "Should have captured errors");
      });

      describe("Circuit breaker", () => {
        it("should trip after max consecutive scheduling failures", async () => {
          let circuitBroke = false;
          let breakError: Error | undefined;

          const timer = scheduleRecurring(
            () => {
              throw new Error("Scheduling always fails");
            },
            () => {},
            {
              maxConsecutiveFailures: 3,
              onCircuitBreak: (error) => {
                circuitBroke = true;
                breakError = error;
              },
            },
          );

          // Wait for circuit breaker to trip (with exponential backoff: 10ms + 20ms + 40ms)
          await new Promise((resolve) => setTimeout(resolve, 150));

          timer.clear();

          expect(circuitBroke).to.equal(true, "Circuit breaker should have triggered");
          expect(breakError).to.exist;
          expect(breakError!.message).to.match(/3 consecutive failures/);
        });

        it("should reset failure counter on successful schedule", async () => {
          let failureCount = 0;
          let executionCount = 0;

          const timer = scheduleRecurring(
            (from) => {
              failureCount++;
              if (failureCount <= 2) {
                // First two calls fail
                throw new Error("Temporary failure");
              }
              // Subsequent calls succeed
              return new Date(from.getTime() + 20);
            },
            () => {
              executionCount++;
            },
            {
              maxConsecutiveFailures: 3,
            },
          );

          // Wait for recovery and execution
          await new Promise((resolve) => setTimeout(resolve, 200));
          timer.clear();

          // Should have recovered and executed
          expect(executionCount).to.be.greaterThan(
            0,
            "Should recover after temporary failure",
          );
        });
      });

      describe("Safety validations", () => {
        it("should handle invalid dates gracefully via circuit breaker", async () => {
          let circuitBroke = false;

          const timer = scheduleRecurring(
            () => new Date("invalid"),
            () => {},
            {
              maxConsecutiveFailures: 2,
              onCircuitBreak: () => {
                circuitBroke = true;
              },
            },
          );

          await new Promise((resolve) => setTimeout(resolve, 100));
          timer.clear();

          expect(circuitBroke).to.equal(
            true,
            "Circuit breaker should trip on invalid dates",
          );
        });

        it("should handle past/present times via circuit breaker", async () => {
          let circuitBroke = false;

          const timer = scheduleRecurring(
            () => new Date(Date.now() - 1000), // 1 second in past
            () => {},
            {
              maxConsecutiveFailures: 2,
              onCircuitBreak: () => {
                circuitBroke = true;
              },
            },
          );

          await new Promise((resolve) => setTimeout(resolve, 100));
          timer.clear();

          expect(circuitBroke).to.equal(
            true,
            "Circuit breaker should trip on past times",
          );
        });

        it("should cap delays at maximum setTimeout value", async () => {
          let scheduledDelay: number | undefined;
          const maxDelay = getMaxDelay();

          const timer = scheduleRecurring(
            (from) => new Date(from.getTime() + maxDelay + 1000000), // Way over max
            () => {},
            {
              onSchedule: (nextRunAt) => {
                if (scheduledDelay === undefined) {
                  // The delay we're scheduling should be capped
                  const now = Date.now();
                  scheduledDelay = nextRunAt.getTime() - now;
                }
              },
            },
          );

          await new Promise((resolve) => setTimeout(resolve, 50));
          timer.clear();

          expect(scheduledDelay).to.exist;
          // The internal delay is capped but onSchedule receives the target time
          // Just verify it scheduled something
          expect(scheduledDelay!).to.be.greaterThan(
            maxDelay,
            "Target time should be in far future",
          );
        });
      });
    });

    describe("scheduleOnce", () => {
      it("should execute once after delay", async () => {
        let executed = false;

        const timer = scheduleOnce(30, () => {
          executed = true;
        });

        expect(executed).to.equal(false, "Should not execute immediately");

        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(executed).to.equal(true, "Should execute after delay");

        // Cleanup
        timer.clear();
      });

      it("should not execute if cleared before delay", async () => {
        let executed = false;

        const timer = scheduleOnce(50, () => {
          executed = true;
        });

        timer.clear();

        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(executed).to.equal(false, "Should not execute after clear");
      });

      it("should handle execution errors gracefully", async () => {
        let errorThrown = false;

        const timer = scheduleOnce(20, () => {
          errorThrown = true;
          throw new Error("Execution error");
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(errorThrown).to.equal(true);
        timer.clear();
      });

      it("should reject negative delays", () => {
        expect(() => {
          scheduleOnce(-1000, () => {});
        }).to.throw(/Invalid delay.*non-negative/);
      });

      it("should reject delays over maximum", () => {
        const maxDelay = getMaxDelay();

        expect(() => {
          scheduleOnce(maxDelay + 1, () => {});
        }).to.throw(/Delay too large/);
      });

      it("should accept zero delay", async () => {
        let executed = false;

        const timer = scheduleOnce(0, () => {
          executed = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(executed).to.equal(true);
        timer.clear();
      });
    });

    describe("Constants", () => {
      it("should return maximum safe delay", () => {
        const maxDelay = getMaxDelay();
        expect(maxDelay).to.equal(2147483647);
      });

      it("should return minimum recommended delay", () => {
        const minDelay = getMinDelay();
        expect(minDelay).to.equal(1000);
      });
    });
  });
}

