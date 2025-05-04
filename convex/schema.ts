import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  pharmacists: defineTable({
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // How the name appears in the rota
    email: v.optional(v.string()),
    // Temporarily add legacy fields during migration
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    band: v.string(),
    primaryDirectorate: v.string(),
    warfarinTrained: v.boolean(),
    specialistTraining: v.optional(v.array(v.string())),
    ituTrained: v.boolean(),
    isDefaultPharmacist: v.boolean(),
    preferences: v.array(v.string()),
    availability: v.array(v.string()),
    workingDays: v.optional(v.array(v.string())),
    isAdmin: v.boolean(),
    trainedDirectorates: v.array(v.string()),
    primaryWards: v.array(v.string()),
    notAvailableRules: v.optional(v.array(v.object({
      dayOfWeek: v.string(), // e.g., "Wednesday"
      startTime: v.string(), // e.g., "13:00"
      endTime: v.string(),   // e.g., "17:00"
    }))),
  }).index("by_band", ["band"]),

  directorates: defineTable({
    name: v.string(),
    wards: v.array(
      v.object({
        name: v.string(),
        isActive: v.boolean(),
        minPharmacists: v.number(),
        idealPharmacists: v.number(),
        requiresSpecialTraining: v.boolean(),
        trainingType: v.optional(v.string()),
        difficulty: v.number(),
      })
    ),
    specialTrainingTypes: v.optional(v.array(v.string())),
  }).index("by_name", ["name"]),

  clinics: defineTable({
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
  }).index("by_day", ["dayOfWeek"]),

  dispensaryShifts: defineTable({
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    isLunchCover: v.boolean(),
  }).index("by_day", ["dayOfWeek"]),

  rotas: defineTable({
    date: v.string(),
    assignments: v.array(
      v.object({
        pharmacistId: v.id("pharmacists"),
        type: v.union(v.literal("ward"), v.literal("dispensary"), v.literal("clinic"), v.literal("management")),
        location: v.string(),
        startTime: v.string(),
        endTime: v.string(),
        isLunchCover: v.optional(v.boolean()),
      })
    ),
    // Store free text edits (key-value pairs where key is cellId and value is text)
    freeCellText: v.optional(v.record(v.string(), v.string())),
    status: v.union(v.literal("draft"), v.literal("published"), v.literal("archived")),
    generatedBy: v.string(),
    generatedAt: v.number(),
    // Weekday inclusion tracking for bank holidays and special days
    includedWeekdays: v.optional(v.array(v.string())), // List of weekdays that were included in rota generation
    // Publication metadata
    publishedBy: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    publishDate: v.optional(v.string()), // Formatted date
    publishTime: v.optional(v.string()), // Formatted time
    publishedSetId: v.optional(v.string()), // ID to group published rotas by set
    originalRotaId: v.optional(v.id("rotas")), // Reference to the original rota
    conflicts: v.optional(v.array(
      v.object({
        type: v.string(),
        description: v.string(),
        severity: v.union(v.literal("warning"), v.literal("error")),
      })
    )),
  }).index("by_date", ["date"]),

  rotaRules: defineTable({
    name: v.string(),
    description: v.string(),
    isActive: v.boolean(),
    priority: v.number(), // 1-10, higher is more important
    type: v.union(
      v.literal("dispensary"),
      v.literal("ward"),
      v.literal("clinic"),
      v.literal("general")
    ),
  }),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
