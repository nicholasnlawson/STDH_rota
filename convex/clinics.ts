import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const initializeClinics = mutation({
  args: {},
  handler: async (ctx) => {
    const clinics = [
      {
        name: "PHARM1A",
        dayOfWeek: 1, // Monday
        startTime: "09:00",
        endTime: "13:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: false,
        isActive: true,
        coverageNote: "Usually covered by a pharmacy technician from a different team",
        includeByDefaultInRota: false,
      },
      {
        name: "PHAR2PSP",
        dayOfWeek: 2, // Tuesday
        startTime: "13:00",
        endTime: "15:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: true,
        isActive: true,
        coverageNote: undefined,
        includeByDefaultInRota: false,
      },
      {
        name: "PHAR2PGC",
        dayOfWeek: 2, // Tuesday
        startTime: "13:00",
        endTime: "15:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: false,
        isActive: true,
        coverageNote: "Usually covered by a pharmacy technician from a different team",
        includeByDefaultInRota: false,
      },
      {
        name: "PHARM3A",
        dayOfWeek: 3, // Wednesday
        startTime: "09:00",
        endTime: "13:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: false,
        isActive: true,
        coverageNote: "Usually covered by a pharmacy technician from a different team",
        includeByDefaultInRota: false,
      },
      {
        name: "PHARM4A",
        dayOfWeek: 4, // Thursday
        startTime: "09:00",
        endTime: "13:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: false,
        isActive: true,
        coverageNote: "Usually covered by a pharmacy technician from a different team",
        includeByDefaultInRota: false,
      },
      {
        name: "PHAR5AFC",
        dayOfWeek: 5, // Friday
        startTime: "09:00",
        endTime: "13:00",
        requiresWarfarinTraining: true,
        travelTimeBefore: 30,
        travelTimeAfter: 30,
        isRegular: false,
        isActive: true,
        coverageNote: "Usually covered by a pharmacy technician from a different team",
        includeByDefaultInRota: false,
      },
    ];

    for (const clinic of clinics) {
      const existing = await ctx.db
        .query("clinics")
        .filter((q) => q.eq(q.field("name"), clinic.name))
        .unique();
      
      if (existing) {
        await ctx.db.patch(existing._id, clinic);
      } else {
        await ctx.db.insert("clinics", clinic);
      }
    }
  },
});

export const listClinics = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("clinics").collect();
  },
});

export const updateClinic = mutation({
  args: {
    clinicId: v.id("clinics"),
    name: v.string(),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    requiresWarfarinTraining: v.boolean(),
    travelTimeBefore: v.number(),
    travelTimeAfter: v.number(),
    isRegular: v.boolean(),
    isActive: v.boolean(),
    coverageNote: v.optional(v.string()),
    includeByDefaultInRota: v.boolean(),
    preferredPharmacists: v.optional(v.array(v.id("pharmacists"))),
  },
  handler: async (ctx, args) => {
    const { clinicId, ...rest } = args;
    await ctx.db.patch(clinicId, rest);
  },
});

// --- Add Clinic Mutation ---
export const addClinic = mutation({
  args: {
    name: v.string(),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    coverageNote: v.optional(v.string()),
    isActive: v.boolean(),
    requiresWarfarinTraining: v.optional(v.boolean()),
    travelTimeBefore: v.optional(v.number()),
    travelTimeAfter: v.optional(v.number()),
    isRegular: v.optional(v.boolean()),
    includeByDefaultInRota: v.optional(v.boolean()),
    preferredPharmacists: v.optional(v.array(v.id("pharmacists"))),
  },
  handler: async (ctx, args) => {
    // Provide sensible defaults for optional fields
    const clinic = {
      name: args.name,
      dayOfWeek: args.dayOfWeek,
      startTime: args.startTime,
      endTime: args.endTime,
      coverageNote: args.coverageNote,
      isActive: args.isActive,
      requiresWarfarinTraining: args.requiresWarfarinTraining ?? false,
      travelTimeBefore: args.travelTimeBefore ?? 0,
      travelTimeAfter: args.travelTimeAfter ?? 0,
      isRegular: args.isRegular ?? false,
      includeByDefaultInRota: args.includeByDefaultInRota ?? false,
      preferredPharmacists: args.preferredPharmacists ?? [],
    };
    return await ctx.db.insert("clinics", clinic);
  }
});

// --- Delete Clinic Mutation ---
export const deleteClinic = mutation({
  args: { clinicId: v.id("clinics") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.clinicId);
  }
});

// --- Backfill includeByDefaultInRota for all clinics ---
export const backfillIncludeByDefaultInRota = mutation({
  args: {},
  handler: async (ctx) => {
    const clinics = await ctx.db.query("clinics").collect();
    for (const clinic of clinics) {
      await ctx.db.patch(clinic._id, {
        includeByDefaultInRota: clinic.name === "PHAR2PSP"
      });
    }
    return clinics.length;
  }
});
