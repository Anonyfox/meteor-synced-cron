/**
 * Tests for unified scheduler
 * Covers UTC/local time, aligned intervals, cron expressions, and edge cases
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import { getNextScheduledTime } from "./scheduler";

if (Meteor.isServer) {
  describe("Scheduler", () => {
    describe("Interval Schedules", () => {
      it("should schedule 'every X seconds'", () => {
        const schedule = { every: 30, unit: "seconds" as const };
        const next = getNextScheduledTime(schedule);
        const now = Date.now();

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now);
        expect(next.getTime()).to.be.at.most(now + 31000);
      });

      it("should schedule 'every X minutes'", () => {
        const schedule = { every: 5, unit: "minutes" as const };
        const next = getNextScheduledTime(schedule);
        const now = Date.now();

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now);
        expect(next.getTime()).to.be.at.most(now + 5 * 60 * 1000 + 1000);
      });

      it("should schedule 'every X hours'", () => {
        const schedule = { every: 2, unit: "hours" as const };
        const next = getNextScheduledTime(schedule);
        const now = Date.now();

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now);
        expect(next.getTime()).to.be.at.most(now + 2 * 60 * 60 * 1000 + 1000);
      });

      it("should schedule 'every X days'", () => {
        const schedule = { every: 1, unit: "days" as const };
        const next = getNextScheduledTime(schedule);
        const now = Date.now();

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now);
        expect(next.getTime()).to.be.at.most(now + 24 * 60 * 60 * 1000 + 1000);
      });
    });

    describe("Aligned Intervals", () => {
      it("should align 'every 15 minutes' to quarter hours", () => {
        const schedule = { every: 15, unit: "minutes" as const, aligned: true };
        const next = getNextScheduledTime(schedule);

        // Should be on a 15-minute boundary
        expect([0, 15, 30, 45]).to.include(next.getMinutes());
        expect(next.getSeconds()).to.equal(0);
        expect(next.getMilliseconds()).to.equal(0);
      });

      it("should align 'every 1 hour' to top of hour", () => {
        const schedule = { every: 1, unit: "hours" as const, aligned: true };
        const next = getNextScheduledTime(schedule);

        expect(next.getMinutes()).to.equal(0);
        expect(next.getSeconds()).to.equal(0);
        expect(next.getMilliseconds()).to.equal(0);
      });

      it("should align 'every 6 hours' to 6-hour boundaries", () => {
        const schedule = { every: 6, unit: "hours" as const, aligned: true };
        const next = getNextScheduledTime(schedule);

        // Should be on a 6-hour boundary: 0, 6, 12, or 18
        expect([0, 6, 12, 18]).to.include(next.getHours());
        expect(next.getMinutes()).to.equal(0);
      });

      it("should not align when aligned=false", () => {
        const schedule = {
          every: 15,
          unit: "minutes" as const,
          aligned: false,
        };
        const now = new Date();
        const next = getNextScheduledTime(schedule);

        // Should just add 15 minutes, not align
        const expectedMs = now.getTime() + 15 * 60 * 1000;
        expect(Math.abs(next.getTime() - expectedMs)).to.be.lessThan(1000);
      });
    });

    describe("Daily At Schedule", () => {
      it("should schedule at specific time", () => {
        const now = new Date();
        const futureHour = (now.getHours() + 1) % 24;
        const schedule = { at: `${String(futureHour).padStart(2, "0")}:30` };

        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now.getTime());
        expect(next.getHours()).to.equal(futureHour);
        expect(next.getMinutes()).to.equal(30);
        expect(next.getSeconds()).to.equal(0);
      });

      it("should schedule for next day if time has passed", () => {
        const now = new Date();
        const pastHour = (now.getHours() - 1 + 24) % 24;
        const schedule = { at: `${String(pastHour).padStart(2, "0")}:00` };

        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getTime()).to.be.greaterThan(now.getTime());
        // Should be roughly 23 hours in future
        const diff = next.getTime() - now.getTime();
        expect(diff).to.be.greaterThan(22 * 60 * 60 * 1000);
        expect(diff).to.be.lessThan(24 * 60 * 60 * 1000);
      });

      it("should throw on invalid 'at' format", () => {
        expect(() => {
          getNextScheduledTime({ at: "invalid" });
        }).to.throw(/Invalid 'at' format/);
      });

      it("should throw on invalid hour", () => {
        expect(() => {
          getNextScheduledTime({ at: "25:00" });
        }).to.throw(/Invalid hour/);
      });

      it("should throw on invalid minute", () => {
        expect(() => {
          getNextScheduledTime({ at: "12:75" });
        }).to.throw(/Invalid minute/);
      });
    });

    describe("Cron Expressions", () => {
      it("should parse 'every minute' cron", () => {
        const schedule = { cron: "* * * * *" };
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getSeconds()).to.equal(0);
        // Should be within 2 minutes
        expect(next.getTime() - Date.now()).to.be.at.most(2 * 60 * 1000);
      });

      it("should parse 'top of hour' cron", () => {
        const schedule = { cron: "0 * * * *" };
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getMinutes()).to.equal(0);
        expect(next.getSeconds()).to.equal(0);
      });

      it("should parse specific hour cron", () => {
        const schedule = { cron: "0 14 * * *" }; // 2 PM daily
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getHours()).to.equal(14);
        expect(next.getMinutes()).to.equal(0);
      });

      it("should parse step cron", () => {
        const schedule = { cron: "*/5 * * * *" }; // Every 5 minutes
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]).to.include(
          next.getMinutes(),
        );
      });

      it("should parse weekday cron", () => {
        const schedule = { cron: "0 9 * * 1-5" }; // Weekdays at 9 AM
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getHours()).to.equal(9);
        expect(next.getMinutes()).to.equal(0);
        // Should be weekday (1-5, where 0=Sunday, 6=Saturday)
        const day = next.getDay();
        expect(day).to.be.at.least(1);
        expect(day).to.be.at.most(5);
      });

      it("should parse day-of-month cron", () => {
        const schedule = { cron: "0 0 15 * *" }; // 15th of each month
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getDate()).to.equal(15);
        expect(next.getHours()).to.equal(0);
        expect(next.getMinutes()).to.equal(0);
      });

      it("should parse last day of month", () => {
        const schedule = { cron: "0 0 L * *" }; // Last day of month
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        // Verify it's actually the last day
        const testDate = new Date(next);
        testDate.setDate(testDate.getDate() + 1);
        expect(testDate.getMonth()).to.not.equal(next.getMonth());
      });
    });

    describe("UTC Mode", () => {
      it("should use local time by default for intervals", () => {
        const schedule = { every: 1, unit: "hours" as const, aligned: true };
        const next = getNextScheduledTime(schedule, { utc: false });

        // In local time, aligned to top of hour
        expect(next.getMinutes()).to.equal(0);
      });

      it("should use UTC when utc=true for intervals", () => {
        const schedule = { every: 1, unit: "hours" as const, aligned: true };
        const next = getNextScheduledTime(schedule, { utc: true });

        // In UTC, aligned to top of hour
        expect(next.getUTCMinutes()).to.equal(0);
      });

      it("should use local time by default for daily at", () => {
        const now = new Date();
        const futureHour = (now.getHours() + 1) % 24;
        const schedule = { at: `${String(futureHour).padStart(2, "0")}:00` };
        const next = getNextScheduledTime(schedule, { utc: false });

        // Should match local hour
        expect(next.getHours()).to.equal(futureHour);
      });

      it("should use UTC for daily at when utc=true", () => {
        const now = new Date();
        const futureHour = (now.getUTCHours() + 1) % 24;
        const schedule = { at: `${String(futureHour).padStart(2, "0")}:00` };
        const next = getNextScheduledTime(schedule, { utc: true });

        // Should match UTC hour
        expect(next.getUTCHours()).to.equal(futureHour);
      });

      it("should use local time by default for cron", () => {
        // Schedule at a specific hour that differs between local and UTC
        const now = new Date();
        const localHour = (now.getHours() + 1) % 24;
        const schedule = {
          cron: `0 ${localHour} * * *`,
        };
        const next = getNextScheduledTime(schedule, { utc: false });

        expect(next.getHours()).to.equal(localHour);
      });

      it("should use UTC for cron when utc=true", () => {
        const now = new Date();
        const utcHour = (now.getUTCHours() + 1) % 24;
        const schedule = {
          cron: `0 ${utcHour} * * *`,
        };
        const next = getNextScheduledTime(schedule, { utc: true });

        expect(next.getUTCHours()).to.equal(utcHour);
      });
    });

    describe("Day-of-Month OR Day-of-Week Logic", () => {
      // When BOTH day-of-month and day-of-week are specified (not *),
      // the job runs if EITHER matches (OR logic)

      it("should run on specific day OR specific weekday", () => {
        // Run on the 15th OR on Monday
        const schedule = { cron: "0 12 15 * 1" };
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        // Should be either the 15th OR a Monday
        const isThe15th = next.getDate() === 15;
        const isMonday = next.getDay() === 1;
        expect(isThe15th || isMonday).to.equal(true);
      });

      it("should correctly handle day wildcard with specific weekday", () => {
        // Day is wildcard, weekday is specific = run only on that weekday
        const schedule = { cron: "0 12 * * 5" }; // Every Friday at noon
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getDay()).to.equal(5);
      });

      it("should correctly handle specific day with weekday wildcard", () => {
        // Day is specific, weekday is wildcard = run only on that day
        const schedule = { cron: "0 12 20 * *" }; // 20th of every month
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getDate()).to.equal(20);
      });
    });

    describe("Edge Cases", () => {
      it("should throw on invalid schedule format", () => {
        expect(() => {
          // @ts-expect-error Testing invalid input
          getNextScheduledTime({ invalid: true });
        }).to.throw(/Invalid schedule format/);
      });

      it("should throw on invalid cron expression", () => {
        expect(() => {
          getNextScheduledTime({ cron: "invalid" });
        }).to.throw(/Invalid cron expression/);
      });

      it("should handle midnight crossing for daily schedules", () => {
        // Schedule at midnight
        const schedule = { at: "00:00" };
        const next = getNextScheduledTime(schedule);

        expect(next.getHours()).to.equal(0);
        expect(next.getMinutes()).to.equal(0);
        expect(next.getTime()).to.be.greaterThan(Date.now());
      });

      it("should handle year boundary", () => {
        // Cron for Jan 1st
        const schedule = { cron: "0 0 1 1 *" };
        const next = getNextScheduledTime(schedule);

        expect(next).to.be.instanceOf(Date);
        expect(next.getMonth()).to.equal(0); // January
        expect(next.getDate()).to.equal(1);
      });
    });
  });
}

