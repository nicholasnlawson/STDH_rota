import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const add = mutation({
  args: {
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // "Appears in rota as"
    email: v.string(), // Required for authentication
    // Temporarily accept firstName and lastName during migration
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),    
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
    // Extract firstName and lastName if they exist, to exclude them from the database insert
    const { firstName, lastName, ...fieldsToInsert } = args;
    
    // Make sure displayName has a value if not provided
    const fieldsWithDefaults = {
      ...fieldsToInsert,
      displayName: fieldsToInsert.displayName || fieldsToInsert.name
    };
    
    return await ctx.db.insert("pharmacists", fieldsWithDefaults);
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
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // "Appears in rota as"
    email: v.optional(v.string()),
    // Temporarily accept firstName and lastName during migration
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
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
    const { id, firstName, lastName, ...fields } = args;
    // If we have firstName and lastName as inputs, we'll exclude them from the update
    await ctx.db.patch(id, fields);
  },
});
