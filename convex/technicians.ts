import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

export const add = mutation({
  args: {
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // "Appears in rota as"
    email: v.string(), // Required for authentication
    band: v.string(), // Band 4, 5, or 6
    primaryWards: v.array(v.string()), // Primary wards assigned
    isAccuracyChecker: v.boolean(), // Whether technician is an accuracy checker
    isMedsRecTrained: v.boolean(), // Whether technician is medication reconciliation trained
    isWarfarinTrained: v.optional(v.boolean()), // Whether technician is warfarin trained
    isAdmin: v.optional(v.boolean()), // Whether technician has admin privileges
    isDefaultTechnician: v.optional(v.boolean()), // Whether this is the default technician
    preferences: v.array(v.string()),
    availability: v.array(v.string()),
    workingDays: v.array(v.string()), // Usual working days (e.g., ["Monday", "Tuesday"])
    specialistTraining: v.optional(v.array(v.string())),
    notAvailableRules: v.optional(v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    // Make sure displayName has a value if not provided
    const fieldsWithDefaults = {
      ...args,
      displayName: args.displayName || args.name,
      isDefaultTechnician: args.isDefaultTechnician || false,
      workingDays: args.workingDays || []
    };
    
    return await ctx.db.insert("technicians", fieldsWithDefaults);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("technicians")
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("technicians") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id("technicians"),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    band: v.optional(v.string()),
    primaryWards: v.optional(v.array(v.string())),
    isAccuracyChecker: v.optional(v.boolean()),
    isMedsRecTrained: v.optional(v.boolean()),
    isWarfarinTrained: v.optional(v.boolean()),
    isDefaultTechnician: v.optional(v.boolean()),
    isAdmin: v.optional(v.boolean()),
    preferences: v.optional(v.array(v.string())),
    availability: v.optional(v.array(v.string())),
    workingDays: v.optional(v.array(v.string())),
    specialistTraining: v.optional(v.array(v.string())),
    notAvailableRules: v.optional(v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    await ctx.db.patch(id, rest);
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("technicians") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
