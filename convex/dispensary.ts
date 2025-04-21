import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const initializeDispensaryShifts = mutation({
  args: {},
  handler: async (ctx) => {
    const shifts = [];
    // Monday to Friday
    for (let day = 1; day <= 5; day++) {
      shifts.push(
        {
          dayOfWeek: day,
          startTime: "09:00",
          endTime: "11:00",
          isLunchCover: false,
        },
        {
          dayOfWeek: day,
          startTime: "11:00",
          endTime: "13:00",
          isLunchCover: false,
        },
        {
          dayOfWeek: day,
          startTime: "13:00",
          endTime: "15:00",
          isLunchCover: false,
        },
        {
          dayOfWeek: day,
          startTime: "15:00",
          endTime: "17:00",
          isLunchCover: false,
        },
        // Lunch cover
        {
          dayOfWeek: day,
          startTime: "12:30",
          endTime: "13:15",
          isLunchCover: true,
        }
      );
    }

    for (const shift of shifts) {
      const existing = await ctx.db
        .query("dispensaryShifts")
        .filter((q) => 
          q.and(
            q.eq(q.field("dayOfWeek"), shift.dayOfWeek),
            q.eq(q.field("startTime"), shift.startTime),
            q.eq(q.field("isLunchCover"), shift.isLunchCover)
          )
        )
        .unique();
      
      if (existing) {
        await ctx.db.patch(existing._id, shift);
      } else {
        await ctx.db.insert("dispensaryShifts", shift);
      }
    }
  },
});

export const listDispensaryShifts = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("dispensaryShifts")
      .collect();
  },
});
