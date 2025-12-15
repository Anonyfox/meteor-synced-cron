/**
 * Tests for interval scheduler
 */

import { expect } from "chai";
import { Meteor } from "meteor/meteor";
import { getNextIntervalTime, type SimpleSchedule } from "./intervalScheduler";

if (Meteor.isServer) {
  describe("intervalScheduler", () => {
    describe("getNextIntervalTime", () => {
      describe("Drift mode (aligned: false)", () => {
        it("should schedule every N seconds", () => {
          const schedule: SimpleSchedule = {
            every: 30,
            unit: "seconds",
            aligned: false,
          };
          const from = new Date("2025-01-15T10:20:15.500Z");
          const next = getNextIntervalTime(schedule, from, true);

          // Should be 30 seconds later
          const expected = new Date("2025-01-15T10:20:45.500Z");
          expect(next.getTime()).to.equal(expected.getTime());
        });

        it("should schedule every N minutes", () => {
          const schedule: SimpleSchedule = {
            every: 5,
            unit: "minutes",
            aligned: false,
          };
          const from = new Date("2025-01-15T10:20:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCMinutes()).to.equal(25);
          expect(next.getUTCHours()).to.equal(10);
        });

        it("should schedule every N hours", () => {
          const schedule: SimpleSchedule = {
            every: 2,
            unit: "hours",
            aligned: false,
          };
          const from = new Date("2025-01-15T10:30:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCHours()).to.equal(12);
          expect(next.getUTCMinutes()).to.equal(30);
        });

        it("should schedule every N days", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "days",
            aligned: false,
          };
          const from = new Date("2025-01-15T10:30:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCDate()).to.equal(16);
          expect(next.getUTCHours()).to.equal(10);
          expect(next.getUTCMinutes()).to.equal(30);
        });

        it("should preserve milliseconds in drift mode", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "minutes",
            aligned: false,
          };
          const from = new Date("2025-01-15T10:20:30.750Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCMilliseconds()).to.equal(750);
        });
      });

      describe("Aligned mode (aligned: true)", () => {
        describe("Minutes alignment", () => {
          it("should align to :00, :15, :30, :45 for every 15 minutes", () => {
            const schedule: SimpleSchedule = {
              every: 15,
              unit: "minutes",
              aligned: true,
            };

            // From :07 should go to :15
            const from1 = new Date("2025-01-15T10:07:30Z");
            const next1 = getNextIntervalTime(schedule, from1, true);
            expect(next1.getUTCMinutes()).to.equal(15);
            expect(next1.getUTCSeconds()).to.equal(0);

            // From :15 should go to :30
            const from2 = new Date("2025-01-15T10:15:00Z");
            const next2 = getNextIntervalTime(schedule, from2, true);
            expect(next2.getUTCMinutes()).to.equal(30);

            // From :47 should go to next hour :00
            const from3 = new Date("2025-01-15T10:47:00Z");
            const next3 = getNextIntervalTime(schedule, from3, true);
            expect(next3.getUTCHours()).to.equal(11);
            expect(next3.getUTCMinutes()).to.equal(0);
          });

          it("should align to :00, :30 for every 30 minutes", () => {
            const schedule: SimpleSchedule = {
              every: 30,
              unit: "minutes",
              aligned: true,
            };

            const from = new Date("2025-01-15T10:22:00Z");
            const next = getNextIntervalTime(schedule, from, true);

            expect(next.getUTCMinutes()).to.equal(30);
            expect(next.getUTCSeconds()).to.equal(0);
          });

          it("should align to :00 for every 60 minutes", () => {
            const schedule: SimpleSchedule = {
              every: 60,
              unit: "minutes",
              aligned: true,
            };

            const from = new Date("2025-01-15T10:45:00Z");
            const next = getNextIntervalTime(schedule, from, true);

            expect(next.getUTCHours()).to.equal(11);
            expect(next.getUTCMinutes()).to.equal(0);
          });
        });

        describe("Hours alignment", () => {
          it("should align to hour boundaries for every 1 hour", () => {
            const schedule: SimpleSchedule = {
              every: 1,
              unit: "hours",
              aligned: true,
            };

            const from = new Date("2025-01-15T10:37:00Z");
            const next = getNextIntervalTime(schedule, from, true);

            expect(next.getUTCHours()).to.equal(11);
            expect(next.getUTCMinutes()).to.equal(0);
            expect(next.getUTCSeconds()).to.equal(0);
          });

          it("should align to 6-hour boundaries", () => {
            const schedule: SimpleSchedule = {
              every: 6,
              unit: "hours",
              aligned: true,
            };

            // From 7 AM should go to 12 PM
            const from1 = new Date("2025-01-15T07:00:00Z");
            const next1 = getNextIntervalTime(schedule, from1, true);
            expect(next1.getUTCHours()).to.equal(12);

            // From 1 PM should go to 6 PM
            const from2 = new Date("2025-01-15T13:00:00Z");
            const next2 = getNextIntervalTime(schedule, from2, true);
            expect(next2.getUTCHours()).to.equal(18);

            // From 11 PM should go to next day 00:00
            const from3 = new Date("2025-01-15T23:00:00Z");
            const next3 = getNextIntervalTime(schedule, from3, true);
            expect(next3.getUTCDate()).to.equal(16);
            expect(next3.getUTCHours()).to.equal(0);
          });
        });

        describe("Days alignment", () => {
          it("should align to midnight for every 1 day", () => {
            const schedule: SimpleSchedule = {
              every: 1,
              unit: "days",
              aligned: true,
            };

            const from = new Date("2025-01-15T14:30:00Z");
            const next = getNextIntervalTime(schedule, from, true);

            expect(next.getUTCDate()).to.equal(16);
            expect(next.getUTCHours()).to.equal(0);
            expect(next.getUTCMinutes()).to.equal(0);
            expect(next.getUTCSeconds()).to.equal(0);
          });

          it("should handle multi-day alignment", () => {
            const schedule: SimpleSchedule = {
              every: 7,
              unit: "days",
              aligned: true,
            };

            const from = new Date("2025-01-15T10:00:00Z");
            const next = getNextIntervalTime(schedule, from, true);

            expect(next.getUTCDate()).to.equal(22);
            expect(next.getUTCHours()).to.equal(0);
          });
        });

        it("should remove milliseconds in aligned mode", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "hours",
            aligned: true,
          };

          const from = new Date("2025-01-15T10:30:15.750Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCSeconds()).to.equal(0);
          expect(next.getUTCMilliseconds()).to.equal(0);
        });
      });

      describe("Daily 'at' schedules", () => {
        it("should schedule at specific time today", () => {
          const schedule: SimpleSchedule = { at: "14:30" };
          const from = new Date("2025-01-15T10:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCHours()).to.equal(14);
          expect(next.getUTCMinutes()).to.equal(30);
          expect(next.getUTCDate()).to.equal(15);
        });

        it("should schedule for tomorrow if time has passed", () => {
          const schedule: SimpleSchedule = { at: "09:00" };
          const from = new Date("2025-01-15T10:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCDate()).to.equal(16);
          expect(next.getUTCHours()).to.equal(9);
          expect(next.getUTCMinutes()).to.equal(0);
        });

        it("should handle single-digit hours", () => {
          const schedule: SimpleSchedule = { at: "9:30" };
          const from = new Date("2025-01-15T08:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCHours()).to.equal(9);
          expect(next.getUTCMinutes()).to.equal(30);
        });

        it("should handle midnight", () => {
          const schedule: SimpleSchedule = { at: "00:00" };
          const from = new Date("2025-01-15T22:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCDate()).to.equal(16);
          expect(next.getUTCHours()).to.equal(0);
          expect(next.getUTCMinutes()).to.equal(0);
        });

        it("should throw on invalid format", () => {
          const schedule: SimpleSchedule = { at: "invalid" };
          const from = new Date();

          expect(() => getNextIntervalTime(schedule, from, true)).to.throw(
            /Invalid 'at' format/,
          );
        });

        it("should throw on invalid hour", () => {
          const schedule: SimpleSchedule = { at: "25:00" };
          const from = new Date();

          expect(() => getNextIntervalTime(schedule, from, true)).to.throw(
            /Invalid hour/,
          );
        });

        it("should throw on invalid minute", () => {
          const schedule: SimpleSchedule = { at: "12:75" };
          const from = new Date();

          expect(() => getNextIntervalTime(schedule, from, true)).to.throw(
            /Invalid minute/,
          );
        });
      });

      describe("Local time vs UTC", () => {
        it("should use local time when useUTC is false", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "hours",
            aligned: true,
          };

          const from = new Date("2025-01-15T10:30:00Z");
          const next = getNextIntervalTime(schedule, from, false);

          // In local time (UTC+1 based on system), this should align differently
          expect(next).to.be.instanceOf(Date);
          expect(next.getTime()).to.be.greaterThan(from.getTime());
        });

        it("should handle daily 'at' in local time", () => {
          const schedule: SimpleSchedule = { at: "14:30" };
          const from = new Date();
          const next = getNextIntervalTime(schedule, from, false);

          expect(next.getHours()).to.equal(14);
          expect(next.getMinutes()).to.equal(30);
        });
      });

      describe("Edge cases", () => {
        it("should handle month boundaries for daily schedules", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "days",
            aligned: true,
          };

          const from = new Date("2025-01-31T10:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCMonth()).to.equal(1); // February
          expect(next.getUTCDate()).to.equal(1);
        });

        it("should handle year boundaries", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "days",
            aligned: true,
          };

          const from = new Date("2025-12-31T10:00:00Z");
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCFullYear()).to.equal(2026);
          expect(next.getUTCMonth()).to.equal(0); // January
          expect(next.getUTCDate()).to.equal(1);
        });

        it("should handle leap year February", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "days",
            aligned: true,
          };

          const from = new Date("2024-02-28T10:00:00Z"); // Leap year
          const next = getNextIntervalTime(schedule, from, true);

          expect(next.getUTCDate()).to.equal(29);
          expect(next.getUTCMonth()).to.equal(1); // February
        });
      });

      describe("Default behavior", () => {
        it("should default to drift mode when aligned is not specified", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "hours",
          };

          const from = new Date("2025-01-15T10:37:25.500Z");
          const next = getNextIntervalTime(schedule, from, true);

          // Drift mode preserves exact time offset
          expect(next.getUTCMinutes()).to.equal(37);
          expect(next.getUTCSeconds()).to.equal(25);
          expect(next.getUTCMilliseconds()).to.equal(500);
        });

        it("should default to local time when useUTC is not specified", () => {
          const schedule: SimpleSchedule = {
            every: 1,
            unit: "minutes",
          };

          const from = new Date();
          const next = getNextIntervalTime(schedule, from);

          expect(next.getTime()).to.be.greaterThan(from.getTime());
          const diff = next.getTime() - from.getTime();
          expect(diff).to.be.at.least(60000);
          expect(diff).to.be.at.most(60100); // ~1 minute
        });
      });
    });
  });
}

