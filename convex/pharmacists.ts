import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const add = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    band: v.string(),
    primaryDirectorate: v.string(),
    warfarinTrained: v.boolean(),
    ituTrained: v.boolean(),
    isDefaultPharmacist: v.boolean(),
    preferences: v.array(v.string()),
    availability: v.array(v.string()),
    isAdmin: v.boolean(),
    trainedDirectorates: v.array(v.string()),
    primaryWards: v.array(v.string()),
    workingDays: v.array(v.string()),
    specialistTraining: v.optional(v.array(v.string())),
    notAvailableRules: v.optional(v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pharmacists", args);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("pharmacists")
      .collect();
  },
});

export const remove = mutation({
  args: { id: v.id("pharmacists") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id("pharmacists"),
    name: v.string(),
    email: v.string(),
    band: v.string(),
    primaryDirectorate: v.string(),
    warfarinTrained: v.boolean(),
    ituTrained: v.boolean(),
    isDefaultPharmacist: v.boolean(),
    preferences: v.array(v.string()),
    availability: v.array(v.string()),
    isAdmin: v.boolean(),
    trainedDirectorates: v.array(v.string()),
    primaryWards: v.array(v.string()),
    workingDays: v.array(v.string()),
    specialistTraining: v.optional(v.array(v.string())),
    notAvailableRules: v.optional(v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    return await ctx.db.patch(id, fields);
  }
});
