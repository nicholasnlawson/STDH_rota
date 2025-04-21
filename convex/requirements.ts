import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const initializeDirectorates = mutation({
  args: {},
  handler: async (ctx) => {
    const directorates = [
      {
        name: "Medicine",
        wards: [
          {
            name: "Ward 3 - Gastroenterology",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 7,
          },
          {
            name: "Ward 5 - Renal/Oncology",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 8,
          },
          {
            name: "Ward 6 - CCU/Cardiology",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 8,
          },
          {
            name: "Ward 7 - Endocrinology",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 6,
          },
          {
            name: "Ward 10 - Respiratory",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 7,
          },
          {
            name: "Ward 12 - Winter Pressures",
            isActive: false,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 5,
          },
        ],
      },
      {
        name: "Surgery",
        wards: [
          {
            name: "Ward 1 - Orthopaedics",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 6,
          },
          {
            name: "Ward 9 - Surgical Centre In-Patients",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 7,
          },
        ],
      },
      {
        name: "EAU",
        wards: [
          {
            name: "Emergency Assessment Unit",
            isActive: true,
            minPharmacists: 1,
            idealPharmacists: 2,
            requiresSpecialTraining: false,
            difficulty: 9,
          },
        ],
      },
      {
        name: "ITU",
        wards: [
          {
            name: "ITU",
            isActive: true,
            minPharmacists: 0,
            idealPharmacists: 1,
            requiresSpecialTraining: true,
            trainingType: "ITU",
            difficulty: 10,
          },
        ],
      },
      {
        name: "Care of the Elderly",
        wards: [
          {
            name: "Ward 2 - Care of the Elderly",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 5,
          },
          {
            name: "Ward 8 - Care of the Elderly",
            isActive: true,
            minPharmacists: 0.5,
            idealPharmacists: 1,
            requiresSpecialTraining: false,
            difficulty: 5,
          },
        ],
      },
    ];

    for (const directorate of directorates) {
      const existing = await ctx.db
        .query("directorates")
        .withIndex("by_name", q => q.eq("name", directorate.name))
        .unique();
      
      if (existing) {
        await ctx.db.patch(existing._id, directorate);
      } else {
        await ctx.db.insert("directorates", directorate);
      }
    }
  },
});

export const listDirectorates = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("directorates").collect();
  },
});

export const updateWard = mutation({
  args: {
    directorateName: v.string(),
    wardName: v.string(),
    minPharmacists: v.number(),
    idealPharmacists: v.number(),
    isActive: v.boolean(),
    requiresSpecialTraining: v.boolean(),
    trainingType: v.optional(v.string()),
    difficulty: v.number(),
  },
  handler: async (ctx, args) => {
    const directorate = await ctx.db
      .query("directorates")
      .withIndex("by_name", q => q.eq("name", args.directorateName))
      .unique();
    
    if (!directorate) {
      throw new Error("Directorate not found");
    }

    const updatedWards = directorate.wards.map(ward => {
      if (ward.name === args.wardName) {
        return {
          ...ward,
          minPharmacists: args.minPharmacists,
          idealPharmacists: args.idealPharmacists,
          isActive: args.isActive,
          requiresSpecialTraining: args.requiresSpecialTraining,
          trainingType: args.trainingType,
          difficulty: args.difficulty,
        };
      }
      return ward;
    });

    return await ctx.db.patch(directorate._id, {
      wards: updatedWards,
    });
  },
});

// --- Add mutation to update specialist training types for a directorate ---
export const updateDirectorateSpecialTrainingTypes = mutation({
  args: {
    name: v.string(),
    specialTrainingTypes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const directorate = await ctx.db
      .query("directorates")
      .withIndex("by_name", q => q.eq("name", args.name))
      .unique();
    if (!directorate) throw new Error("Directorate not found");
    return await ctx.db.patch(directorate._id, {
      specialTrainingTypes: args.specialTrainingTypes,
    });
  },
});

// --- Add mutation to update specialist training types for a directorate and remove deleted types from all pharmacists ---
export const updateDirectorateSpecialTrainingTypesAndRemoveFromPharmacists = mutation({
  args: {
    name: v.string(),
    specialTrainingTypes: v.array(v.string()),
    deletedTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Update the directorate's specialTrainingTypes
    const directorate = await ctx.db
      .query("directorates")
      .withIndex("by_name", q => q.eq("name", args.name))
      .unique();
    if (!directorate) throw new Error("Directorate not found");
    await ctx.db.patch(directorate._id, {
      specialTrainingTypes: args.specialTrainingTypes,
    });

    // Remove deleted training types from all pharmacists
    if (args.deletedTypes && args.deletedTypes.length > 0) {
      const allPharmacists = await ctx.db.query("pharmacists").collect();
      for (const pharmacist of allPharmacists) {
        if (pharmacist.specialistTraining) {
          const updated = pharmacist.specialistTraining.filter(
            t => !args.deletedTypes!.includes(t)
          );
          if (updated.length !== pharmacist.specialistTraining.length) {
            await ctx.db.patch(pharmacist._id, { specialistTraining: updated });
          }
        }
      }
    }
  },
});

// --- Add mutation to add a new ward to a directorate ---
export const addWard = mutation({
  args: {
    directorateName: v.string(),
    ward: v.object({
      name: v.string(),
      minPharmacists: v.number(),
      idealPharmacists: v.number(),
      isActive: v.boolean(),
      requiresSpecialTraining: v.boolean(),
      trainingType: v.optional(v.string()),
      difficulty: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const directorate = await ctx.db
      .query("directorates")
      .withIndex("by_name", q => q.eq("name", args.directorateName))
      .unique();
    if (!directorate) {
      throw new Error("Directorate not found");
    }
    // Prevent duplicate ward names
    if (directorate.wards.some(w => w.name === args.ward.name)) {
      throw new Error("Ward with this name already exists in the directorate");
    }
    const updatedWards = [...directorate.wards, args.ward];
    return await ctx.db.patch(directorate._id, {
      wards: updatedWards,
    });
  },
});

// --- Add mutation to delete a ward from a directorate ---
export const deleteWard = mutation({
  args: {
    directorateName: v.string(),
    wardName: v.string(),
  },
  handler: async (ctx, args) => {
    const directorate = await ctx.db
      .query("directorates")
      .withIndex("by_name", q => q.eq("name", args.directorateName))
      .unique();
    if (!directorate) {
      throw new Error("Directorate not found");
    }
    const updatedWards = directorate.wards.filter(w => w.name !== args.wardName);
    return await ctx.db.patch(directorate._id, {
      wards: updatedWards,
    });
  },
});
