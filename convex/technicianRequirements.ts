import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Initialize system settings and basic training types
export const initializeSystemSettings = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if any training types already exist
    const existingTypes = await ctx.db.query("technicianTrainingTypes").collect();
    
    if (existingTypes.length === 0) {
      // Initialize basic training types
      const trainingTypes = [
        { name: "AccuracyChecker", description: "Accuracy checking certified" },
        { name: "MedsRec", description: "Medicines reconciliation trained" },
        { name: "Warfarin", description: "Warfarin clinic trained" }
      ];
  
      for (const type of trainingTypes) {
        await ctx.db.insert("technicianTrainingTypes", type);
      }
      return { message: "Basic training types initialized" };
    }
    
    return { message: "System already initialized" };
  },
});

// Query all technician requirements
export const listRequirements = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("technicianRequirements").collect();
  },
});

// Get all technician training types
export const listTrainingTypes = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("technicianTrainingTypes").collect();
  },
});

// Add a new technician requirement
export const addRequirement = mutation({
  args: {
    name: v.string(),
    isActive: v.boolean(),
    minTechnicians: v.number(),
    idealTechnicians: v.number(),
    requiresSpecialTraining: v.boolean(),
    trainingType: v.optional(v.string()),
    difficulty: v.number(),
    category: v.string(),
    includeByDefaultInRota: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Check if a requirement with this name already exists
    const existingRequirement = await ctx.db
      .query("technicianRequirements")
      .filter(q => q.eq(q.field("name"), args.name))
      .first();

    if (existingRequirement) {
      throw new Error(`Requirement with name '${args.name}' already exists`);
    }

    return await ctx.db.insert("technicianRequirements", args);
  },
});

// Update an existing technician requirement
export const updateRequirement = mutation({
  args: {
    id: v.id("technicianRequirements"),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    minTechnicians: v.optional(v.number()),
    idealTechnicians: v.optional(v.number()),
    requiresSpecialTraining: v.optional(v.boolean()),
    trainingType: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    category: v.optional(v.string()),
    includeByDefaultInRota: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return { success: true };
  },
});

// Delete a technician requirement
export const deleteRequirement = mutation({
  args: {
    id: v.id("technicianRequirements"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Add a new training type
export const addTrainingType = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if a training type with this name already exists
    const existingType = await ctx.db
      .query("technicianTrainingTypes")
      .filter(q => q.eq(q.field("name"), args.name))
      .first();

    if (existingType) {
      throw new Error(`Training type '${args.name}' already exists`);
    }

    return await ctx.db.insert("technicianTrainingTypes", args);
  },
});

// Update a training type
export const updateTrainingType = mutation({
  args: {
    id: v.id("technicianTrainingTypes"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return { success: true };
  },
});

// Delete a training type
export const deleteTrainingType = mutation({
  args: {
    id: v.id("technicianTrainingTypes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Delete a category from all requirements
export const deleteCategory = mutation({
  args: {
    category: v.string(),
  },
  handler: async (ctx, args) => {
    // Find all requirements with this category
    const requirements = await ctx.db
      .query("technicianRequirements")
      .filter(q => q.eq(q.field("category"), args.category))
      .collect();
    
    // Delete all requirements in this category
    for (const req of requirements) {
      await ctx.db.delete(req._id);
    }
    
    return { 
      success: true, 
      deletedCount: requirements.length,
      message: `Successfully deleted category '${args.category}' and ${requirements.length} requirements.`
    };
  },
});

// Reset all technician requirements and training types
export const resetRequirements = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete all requirements
    const allRequirements = await ctx.db.query("technicianRequirements").collect();
    for (const req of allRequirements) {
      await ctx.db.delete(req._id);
    }
    
    // Delete all training types
    const allTrainingTypes = await ctx.db.query("technicianTrainingTypes").collect();
    for (const type of allTrainingTypes) {
      await ctx.db.delete(type._id);
    }
    
    return { 
      message: "All technician requirements and training types deleted", 
      requirementsDeleted: allRequirements.length,
      trainingTypesDeleted: allTrainingTypes.length
    };
  },
});
