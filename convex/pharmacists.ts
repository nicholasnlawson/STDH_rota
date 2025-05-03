import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const add = mutation({
  args: {
    // Legacy field - keeping for backward compatibility
    name: v.string(),
    // New name fields
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    displayName: v.optional(v.string()), // "Appears in rota as"
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
    // If firstName/lastName are provided, update both displayName and the legacy name field
    let argsWithNames = { ...args };
    
    if (args.firstName && args.lastName) {
      // Set a full name in the legacy name field for search purposes
      argsWithNames.name = `${args.firstName} ${args.lastName}`;
      
      // Only set displayName if it's not provided
      if (!args.displayName) {
        argsWithNames.displayName = `${args.firstName} ${args.lastName.charAt(0)}.`;
      }
    } else if (!args.displayName) {
      // Fallback to the legacy name field if no displayName is provided
      argsWithNames.displayName = args.name;
    }
    
    return await ctx.db.insert("pharmacists", argsWithNames);
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
    // Legacy field - keeping for backward compatibility
    name: v.string(),
    // New name fields
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    displayName: v.optional(v.string()), // "Appears in rota as"
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
    
    // Similar logic to the add handler
    let fieldsWithNames = { ...fields };
    
    if (fields.firstName && fields.lastName) {
      // Set a full name in the legacy name field for search purposes
      fieldsWithNames.name = `${fields.firstName} ${fields.lastName}`;
      
      // Only set displayName if it's not provided
      if (!fields.displayName) {
        fieldsWithNames.displayName = `${fields.firstName} ${fields.lastName.charAt(0)}.`;
      }
    } else if (!fields.displayName) {
      // Fallback to the legacy name field if no displayName is provided
      fieldsWithNames.displayName = fields.name;
    }
    
    return await ctx.db.patch(id, fieldsWithNames);
  }
});
