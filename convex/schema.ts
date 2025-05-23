import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  // Custom sessions table for admin authentication
  sessions: defineTable({
    userId: v.id("users"),
    sessionId: v.string(),
    createdAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),
  
  pharmacists: defineTable({
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // How the name appears in the rota
    email: v.string(), // Required for authentication
    password: v.optional(v.string()), // Store password for authentication
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
  
  technicians: defineTable({
    name: v.string(), // Full name
    displayName: v.optional(v.string()), // How the name appears in the rota
    email: v.string(), // Required for authentication
    password: v.optional(v.string()), // Store password for authentication
    band: v.string(), // Band 4, 5, or 6
    primaryWards: v.array(v.string()), // Primary wards assigned
    isAccuracyChecker: v.boolean(), // Whether technician is an accuracy checker
    isMedsRecTrained: v.boolean(), // Whether technician is medication reconciliation trained
    isWarfarinTrained: v.optional(v.boolean()), // Whether technician is warfarin trained
    isDefaultTechnician: v.optional(v.boolean()), // Whether this is the default technician
    isAdmin: v.optional(v.boolean()), // Whether this user has admin privileges
    preferences: v.array(v.string()),
    availability: v.array(v.string()),
    workingDays: v.optional(v.array(v.string())), // Usual working days (e.g., ["Monday", "Tuesday"])
    specialistTraining: v.optional(v.array(v.string())),
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
    lastEdited: v.optional(v.string()), // Timestamp of the last edit
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

  // Store rota configurations by week to allow resuming work
  rotaConfigurations: defineTable({
    weekStartDate: v.string(), // Monday date in YYYY-MM-DD format
    selectedClinicIds: v.array(v.id("clinics")),
    selectedPharmacistIds: v.array(v.id("pharmacists")),
    selectedWeekdays: v.array(v.string()),
    pharmacistWorkingDays: v.record(v.string(), v.array(v.string())),
    singlePharmacistDispensaryDays: v.array(v.string()),
    ignoredUnavailableRules: v.optional(v.record(v.string(), v.array(v.number()))),
    rotaUnavailableRules: v.optional(v.record(v.string(), v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string()
    })))),
    lastModified: v.number(),
    lastModifiedBy: v.optional(v.string()),
    rotaGeneratedAt: v.optional(v.number()), // Timestamp of last generation
    isGenerated: v.boolean(), // Whether a rota has been generated for this configuration
  }).index("by_weekStartDate", ["weekStartDate"]),
};

// Technician assignments table for rota requirements
const technicianRequirementsTables = {
  technicianRequirements: defineTable({
    name: v.string(), // Assignment name (e.g., "Ward 3 - Accuracy Checking")
    isActive: v.boolean(),
    minTechnicians: v.number(), // Minimum number of technicians needed
    idealTechnicians: v.number(), // Ideal number of technicians
    requiresSpecialTraining: v.boolean(),
    trainingType: v.optional(v.string()), // e.g., "AccuracyChecker", "WarfarinTrained"
    difficulty: v.number(), // 1-10 scale
    category: v.string(), // Category like "Dispensary", "Ward", etc.
    includeByDefaultInRota: v.optional(v.boolean()), // Whether to include in rota by default
    doNotSplitAssignment: v.optional(v.boolean()), // Whether technicians assigned here should not be assigned elsewhere
    daysOfWeek: v.optional(v.array(v.string())), // Days of the week when this requirement is active (e.g., ["Monday", "Wednesday"])
  }).index("by_name", ["name"]),
  
  // Store possible special training types for technicians
  technicianTrainingTypes: defineTable({
    name: v.string(), // Training type name
    description: v.optional(v.string()),
  }).index("by_name", ["name"]),
  
  // Technician rotas
  technicianRotas: defineTable({
    date: v.string(), // ISO date string (YYYY-MM-DD)
    assignments: v.array(
      v.object({
        technicianId: v.id("technicians"),
        type: v.string(), // Type of assignment (requirement, clinic, dispensary, etc.)
        location: v.string(), // Name of assignment (ward, dispensary, etc.)
        startTime: v.string(), // Start time (HH:MM format)
        endTime: v.string(), // End time (HH:MM format)
        category: v.optional(v.string()), // Assignment category
      })
    ),
    conflicts: v.array(
      v.object({
        type: v.string(),
        description: v.string(),
        severity: v.string(), // warning, error
      })
    ),
    includedWeekdays: v.array(v.string()), // List of weekdays included in this rota
    staffIds: v.array(v.id("technicians")), // List of technicians included in this rota
    status: v.string(), // draft, published, archived
    publishedBy: v.optional(
      v.object({
        name: v.string(),
        email: v.string(),
      })
    ),
    publishedDate: v.optional(v.string()), // ISO date when published
    publishDate: v.optional(v.string()), // Formatted date for display
    publishTime: v.optional(v.string()), // Formatted time for display
    freeCellText: v.optional(v.record(v.string(), v.string())), // Optional text for free cells
    title: v.optional(v.string()), // Optional title for the rota
  }).index("by_date", ["date"]),
  
  // Store saved rota configurations for technicians
  technicianRotaConfigurations: defineTable({
    weekStartDate: v.string(), // Monday date string (YYYY-MM-DD)
    technicianIds: v.array(v.id("technicians")), // Selected technicians
    includeWarfarinClinics: v.optional(v.boolean()),
    selectedWeekdays: v.array(v.string()), // List of selected weekdays
    workingDays: v.optional(v.record(v.string(), v.array(v.string()))), // Map of technicianId to their working days
    ignoredUnavailableRules: v.optional(
      v.object({
        technicianId: v.string(),
        ruleIndices: v.array(v.number()),
      })
    ),
    lastUpdated: v.string(), // ISO datetime when last updated
  }).index("by_weekStartDate", ["weekStartDate"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
  ...technicianRequirementsTables,
});
