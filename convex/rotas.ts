import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

// Fisher-Yates shuffle for randomizing pharmacist selection
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type Assignment = {
  pharmacistId: Id<"pharmacists">;
  type: "ward" | "dispensary" | "clinic" | "management";
  location: string;
  startTime: string;
  endTime: string;
  isLunchCover?: boolean;
};

type Conflict = {
  type: string;
  description: string;
  severity: "warning" | "error";
};

// Function to log to terminal (server-side) for debugging
function terminalLog(...args: any[]) {
  console.log("\n[TERMINAL_LOG]", ...args, "\n");
}

export const generateRota = internalMutation({
  args: {
    date: v.string(),
    pharmacistIds: v.array(v.id("pharmacists")),
    clinicIds: v.optional(v.array(v.id("clinics"))),
    dispensaryDutyCounts: v.optional(v.record(v.string(), v.number())),
    weeklyClinicAssignments: v.optional(v.record(v.string(), v.number())),
    singlePharmacistDispensaryDays: v.optional(v.array(v.string())),
    regenerateRota: v.optional(v.boolean()),
    effectiveUnavailableRules: v.optional(v.record(v.string(), v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string()
    })))),
    includedWeekdays: v.optional(v.array(v.string())) // Store which weekdays were included in rota generation
  },
  handler: async (ctx, args) => {
    // Get all the requirements
    const pharmacists = await Promise.all(
      args.pharmacistIds.map(id => ctx.db.get(id))
    );
    const directorates = await ctx.db.query("directorates").collect();
    const allClinics = await ctx.db.query("clinics")
      .filter(q => q.and(q.eq(q.field("isActive"), true)))
      .collect();
    let clinics;
    if (Array.isArray(args.clinicIds) && args.clinicIds.length > 0) {
      clinics = allClinics.filter(c => args.clinicIds?.includes(c._id));
    } else {
      // Use clinics marked as includeByDefaultInRota
      clinics = allClinics.filter(c => c.includeByDefaultInRota);
    }
    // --- ROTA GENERATION STARTS HERE ---
    const dayOfWeek = new Date(args.date).getDay(); // 0 = Sunday, 1 = Monday, ...
    const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayLabel = dayLabels[dayOfWeek];
    
    console.log(`[generateRota] Generating rota for ${args.date} (${dayLabel})`);
    
    // Track assignments and conflicts
    const assignments: Assignment[] = [];
    const conflicts: Conflict[] = [];
    
    // Track pharmacists assigned to full-day dispensary duty so they can be excluded from ward assignments
    const fullDayDispensaryPharmacists = new Set<Id<"pharmacists">>();
    
    // Get working pharmacists for today
    const workingPharmacists = getWorkingPharmacistsForDay(pharmacists, args, dayOfWeek);
    console.log(`[generateRota] ${workingPharmacists.length} pharmacists working today`);
    
    // 1. CLINICS - prioritize clinics above all else
    if (clinics && clinics.length > 0) {
      console.log('[generateRota] Clinics to cover:', clinics.map(clinic => `${clinic.name} (${clinic.dayOfWeek}) preferredPharmacists:${JSON.stringify(clinic.preferredPharmacists || [])}`));
      
      // Filter for clinics on this specific day (dayOfWeek)
      const todaysClinics = clinics.filter(c => c.dayOfWeek === dayOfWeek);
      
      if (todaysClinics.length > 0) {
        console.log(`[generateRota] Processing ${todaysClinics.length} clinics for day ${dayOfWeek}:`, 
          todaysClinics.map(clinic => ({ 
            name: clinic.name, 
            preferredPharmacists: clinic.preferredPharmacists || [],
            time: `${clinic.startTime}-${clinic.endTime}`
          }))
        );
        
        // Log all pharmacists' warfarin training status for debugging
        console.log('[generateRota] Pharmacists warfarin training status:', 
          pharmacists.map(p => p ? {
            id: p._id,
            name: p.name,
            warfarinTrained: p.warfarinTrained,
            band: p.band,
            _id: p._id
          } : null)
        );
        
        // Get today's working pharmacists - this is CRITICAL
        const workingPharmacistsToday = getWorkingPharmacistsForDay(pharmacists, args, dayOfWeek);
        console.log('[generateRota] WORKING PHARMACISTS TODAY:', 
          workingPharmacistsToday.filter(p => p !== null).map(p => ({ 
            id: p?._id, 
            name: p?.name, 
            warfarinTrained: p?.warfarinTrained, 
            band: p?.band 
          }))
        );
        
        terminalLog("WORKING PHARMACISTS FOR DAY", dayOfWeek, 
          workingPharmacistsToday.filter(p => p !== null).map(p => ({ 
            id: p?._id, 
            name: p?.name, 
            warfarinTrained: p?.warfarinTrained, 
            band: p?.band 
          }))
        );
        
        for (const clinic of todaysClinics) {
          let assigned = false;
          
          // Get list of pharmacists who are working today
          let workingPharmacists = workingPharmacistsToday.filter(p => p !== null);
          
          terminalLog(`PROCESSING CLINIC: ${clinic.name} (day ${clinic.dayOfWeek})`, {
            preferredPharmacists: clinic.preferredPharmacists || [],
            timeSlot: `${clinic.startTime}-${clinic.endTime}`
          });
          
          // Sort pharmacists by their weekly clinic assignments to prioritize those with fewer assignments
          const weeklyClinicCounts = args.weeklyClinicAssignments || {};
          
          // Log the current weekly clinic assignments for reference
          if (weeklyClinicCounts && Object.keys(weeklyClinicCounts).length > 0) {
            terminalLog(`Current weekly clinic assignments:`, 
              workingPharmacists
                .filter(p => p !== null)
                .map(p => ({ 
                  name: p?.name, 
                  clinicCount: weeklyClinicCounts[p?._id as string] || 0 
                }))
                .sort((a, b) => a.clinicCount - b.clinicCount)
            );
          }
          
          // STRATEGY 1: Try to assign a preferred pharmacist in priority order
          if (clinic.preferredPharmacists && clinic.preferredPharmacists.length > 0) {
            console.log(`[generateRota] STRATEGY 1: Clinic ${clinic.name} has ${clinic.preferredPharmacists.length} preferred pharmacists:`, clinic.preferredPharmacists);
            
            terminalLog(`STRATEGY 1: Clinic ${clinic.name} has ${clinic.preferredPharmacists.length} preferred pharmacists:`, clinic.preferredPharmacists);
            
            // First, sort preferred pharmacists by how many clinics they've already been assigned to this week
            const sortedPreferredIds = [...clinic.preferredPharmacists].sort((idA, idB) => {
              const countA = weeklyClinicCounts[idA] || 0;
              const countB = weeklyClinicCounts[idB] || 0;
              return countA - countB;
            });
            
            if (sortedPreferredIds.length !== clinic.preferredPharmacists.length) {
              terminalLog(`Reordered preferred pharmacists based on weekly clinic assignments:`, {
                original: clinic.preferredPharmacists,
                sortedByWeeklyClinics: sortedPreferredIds
              });
            }
            
            // Try each preferred pharmacist in newly-sorted order (prioritizing those with fewer weekly clinics)
            for (const pharmacistId of sortedPreferredIds) {
              const pharmacist = workingPharmacists.find(p => p && p._id === pharmacistId);
              
              console.log(`[generateRota] Checking preferred pharmacist ${pharmacistId}:`, 
                pharmacist ? {
                  name: pharmacist.name,
                  warfarinTrained: pharmacist.warfarinTrained,
                  band: pharmacist.band,
                  matches: pharmacist && pharmacist.warfarinTrained ? "YES" : "NO"
                } : "Not found or not working today"
              );
              
              terminalLog(`Checking preferred pharmacist ${pharmacistId}:`, 
                pharmacist ? {
                  name: pharmacist.name,
                  warfarinTrained: pharmacist.warfarinTrained,
                  band: pharmacist.band,
                  matches: pharmacist && pharmacist.warfarinTrained ? "YES" : "NO",
                  isWorking: workingPharmacists.some(p => p && p._id === pharmacistId)
                } : "Not found or not working today"
              );
              
              if (pharmacist && pharmacist.warfarinTrained && !isPharmacistNotAvailable(pharmacist, dayLabel, clinic.startTime, clinic.endTime)) {
                console.log(`[generateRota] SUCCESS: Assigned preferred pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned preferred pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
                break;
              }
            }
          } else {
            console.log(`[generateRota] Clinic ${clinic.name} has no preferred pharmacists, skipping to STRATEGY 2`);
            terminalLog(`Clinic ${clinic.name} has no preferred pharmacists, skipping to STRATEGY 2`);
          }
          
          // STRATEGY 2: Try to find any warfarin-trained Band 6/7 pharmacist with ZERO clinics
          if (!assigned) {
            // Get multi-ward pharmacists to exclude them from clinic assignments
            const multiWardPharmacists = getMultiWardPharmacists(assignments);
            
            const band67Pharmacists = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained &&
              !multiWardPharmacists.has(p._id) // Exclude pharmacists covering multiple wards
            );
            
            // Sort band 6/7 pharmacists by how many clinics they've already been assigned to this week
            const sortedBand67Pharmacists = [...band67Pharmacists].sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            console.log(`[generateRota] STRATEGY 2: Found ${band67Pharmacists.length} warfarin-trained band 6/7 pharmacists:`, 
              band67Pharmacists.map(p => p ? { name: p.name, band: p.band, warfarinTrained: p.warfarinTrained } : null).filter(Boolean)
            );
            
            terminalLog(`STRATEGY 2: Found ${band67Pharmacists.length} warfarin-trained band 6/7 pharmacists, sorted by weekly clinic load:`, 
              sortedBand67Pharmacists.map(p => p ? { 
                name: p.name, 
                band: p.band, 
                warfarinTrained: p.warfarinTrained,
                weeklyClinicCount: weeklyClinicCounts[p._id] || 0
              } : null).filter(Boolean)
            );
            
            // Check for time conflicts
            const assignedPharmacistsByTime: Record<string, string[]> = {};
            
            // Get all assigned pharmacists for the current day with their time slots
            const todaysAssignments = assignments.filter(a => a.type === "clinic");
            todaysAssignments.forEach(assignment => {
              const timeKey = `${assignment.startTime}-${assignment.endTime}`;
              if (!assignedPharmacistsByTime[timeKey]) {
                assignedPharmacistsByTime[timeKey] = [];
              }
              assignedPharmacistsByTime[timeKey].push(assignment.pharmacistId);
            });
            
            // Filter out pharmacists who have already been assigned to a conflicting time slot
            const availableBand67Pharmacists = sortedBand67Pharmacists.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            });
            
            // Use band 6/7 pharmacists if any are available AND at least one has ZERO clinic assignments
            const minBand67ClinicCount = availableBand67Pharmacists.length > 0 
              ? (weeklyClinicCounts[availableBand67Pharmacists[0]?._id] || 0) 
              : Infinity;
            
            // Check if we should use a band 6/7 pharmacist
            const shouldUseBand67 = availableBand67Pharmacists.length > 0 && minBand67ClinicCount === 0; // Only use band 6/7 if they have ZERO clinics
            
            terminalLog(`Should use band 6/7 pharmacist? ${shouldUseBand67 ? 'YES' : 'NO'} (min clinic count: ${minBand67ClinicCount})`);
            
            if (shouldUseBand67) {
              const pharmacist = availableBand67Pharmacists[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
              }
            } else {
              console.log(`[generateRota] No available warfarin-trained band 6/7 pharmacists with ZERO clinics`);
              terminalLog(`No available warfarin-trained band 6/7 pharmacists with ZERO clinics`);
            }
          }
          
          // STRATEGY 3: Try to find any warfarin-trained Band 8a pharmacist with lowest clinic count
          if (!assigned) {
            // Get multi-ward pharmacists to exclude them from clinic assignments
            const multiWardPharmacists = getMultiWardPharmacists(assignments);
            
            const band8aPharmacists = workingPharmacists.filter(p => 
              p && 
              p.band === "8a" && 
              p.warfarinTrained &&
              !multiWardPharmacists.has(p._id) // Exclude pharmacists covering multiple wards
            );
            
            // Sort band 8a pharmacists by how many clinics they've already been assigned to this week
            const sortedBand8aPharmacists = [...band8aPharmacists].sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            console.log(`[generateRota] STRATEGY 3: Found ${band8aPharmacists.length} warfarin-trained band 8a pharmacists:`, 
              band8aPharmacists.map(p => p ? { name: p.name, band: p.band, warfarinTrained: p.warfarinTrained } : null).filter(Boolean)
            );
            
            terminalLog(`STRATEGY 3: Found ${band8aPharmacists.length} warfarin-trained band 8a pharmacists, sorted by weekly clinic load:`, 
              sortedBand8aPharmacists.map(p => p ? { 
                name: p.name, 
                band: p.band, 
                warfarinTrained: p.warfarinTrained,
                weeklyClinicCount: weeklyClinicCounts[p._id] || 0
              } : null).filter(Boolean)
            );
            
            // Check for time conflicts
            const assignedPharmacistsByTime: Record<string, string[]> = {};
            
            // Get all assigned pharmacists for the current day with their time slots
            const todaysAssignments = assignments.filter(a => a.type === "clinic");
            todaysAssignments.forEach(assignment => {
              const timeKey = `${assignment.startTime}-${assignment.endTime}`;
              if (!assignedPharmacistsByTime[timeKey]) {
                assignedPharmacistsByTime[timeKey] = [];
              }
              assignedPharmacistsByTime[timeKey].push(assignment.pharmacistId);
            });
            
            // Filter out pharmacists who have already been assigned to a conflicting time slot
            const availableBand8aPharmacists = sortedBand8aPharmacists.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            });
            
            // Get minimum clinic count for band 8a pharmacists
            const minBand8aClinicCount = availableBand8aPharmacists.length > 0 
              ? (weeklyClinicCounts[availableBand8aPharmacists[0]?._id] || 0) 
              : Infinity;
            
            terminalLog(`Minimum clinic count for band 8a: ${minBand8aClinicCount}`);
            
            // Get band 6/7 pharmacists who have at least 1 clinic
            const band67PharmacistsWithClinics = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained && 
              (weeklyClinicCounts[p._id] || 0) >= 1
            ).sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            // Get minimum clinic count for band 6/7 pharmacists who already have clinics
            const minBand67WithClinicsCount = band67PharmacistsWithClinics.length > 0 
              ? (weeklyClinicCounts[band67PharmacistsWithClinics[0]?._id] || 0) 
              : Infinity;
              
            // Check if band 6/7 have time conflicts
            const availableBand67WithClinics = band67PharmacistsWithClinics.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            });
            
            terminalLog(`Minimum clinic count for band 6/7 with clinics: ${minBand67WithClinicsCount}`);
            
            // DECISION LOGIC: Decide between 8a and 6/7 with clinics
            // We want a proper alternating pattern:
            // - All band 6/7 get their first clinic
            // - Then band 8a gets their first clinic
            // - Then band 6/7 get their second clinic
            // - Then band 8a gets their second clinic
            // - And so on...
            
            const use8aIfAvailable = 
              availableBand67WithClinics.length === 0 || // No band 6/7 available
              (minBand8aClinicCount < minBand67WithClinicsCount); // Band 8a has fewer clinics
            
            terminalLog(`Should use band 8a? ${use8aIfAvailable ? 'YES' : 'NO'} (8a min: ${minBand8aClinicCount}, 6/7 min: ${minBand67WithClinicsCount})`);
            
            if (use8aIfAvailable && availableBand8aPharmacists.length > 0) {
              const pharmacist = availableBand8aPharmacists[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 8a pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 8a pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
              }
            } else if (availableBand67WithClinics.length > 0) {
              const pharmacist = availableBand67WithClinics[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
              }
            }
          }
          
          // STRATEGY 4: Try to find band 6/7 pharmacists who already have 1+ clinics
          if (!assigned) {
            // Get multi-ward pharmacists to exclude them from clinic assignments
            const multiWardPharmacists = getMultiWardPharmacists(assignments);
            
            // Get band 6/7 pharmacists who have at least 1 clinic already
            const band67PharmacistsWithClinics = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained && 
              (weeklyClinicCounts[p._id] || 0) > 0 &&
              !multiWardPharmacists.has(p._id) // Exclude pharmacists covering multiple wards
            );
            
            // Sort band 6/7 pharmacists by how many clinics they've already been assigned to this week
            const sortedBand67Pharmacists = [...band67PharmacistsWithClinics].sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            console.log(`[generateRota] STRATEGY 4: Found ${band67PharmacistsWithClinics.length} warfarin-trained band 6/7 pharmacists:`, 
              band67PharmacistsWithClinics.map(p => p ? { name: p.name, band: p.band, warfarinTrained: p.warfarinTrained } : null).filter(Boolean)
            );
            
            terminalLog(`STRATEGY 4: Found ${band67PharmacistsWithClinics.length} warfarin-trained band 6/7 pharmacists, sorted by weekly clinic load:`, 
              sortedBand67Pharmacists.map(p => p ? { 
                name: p.name, 
                band: p.band, 
                warfarinTrained: p.warfarinTrained,
                weeklyClinicCount: weeklyClinicCounts[p._id] || 0
              } : null).filter(Boolean)
            );
            
            // Check for time conflicts
            const assignedPharmacistsByTime: Record<string, string[]> = {};
            
            // Get all assigned pharmacists for the current day with their time slots
            const todaysAssignments = assignments.filter(a => a.type === "clinic");
            todaysAssignments.forEach(assignment => {
              const timeKey = `${assignment.startTime}-${assignment.endTime}`;
              if (!assignedPharmacistsByTime[timeKey]) {
                assignedPharmacistsByTime[timeKey] = [];
              }
              assignedPharmacistsByTime[timeKey].push(assignment.pharmacistId);
            });
            
            // Filter out pharmacists who have already been assigned to a conflicting time slot
            const availableBand67Pharmacists = sortedBand67Pharmacists.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            });
            
            if (availableBand67Pharmacists.length > 0) {
              const pharmacist = availableBand67Pharmacists[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
              }
            }
          }
          
          // STRATEGY 5: As a last resort - any band 6/7 pharmacist regardless of clinic count
          if (!assigned) {
            // Get multi-ward pharmacists to exclude them from clinic assignments
            const multiWardPharmacists = getMultiWardPharmacists(assignments);
            
            const band67Pharmacists = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained &&
              !multiWardPharmacists.has(p._id) // Exclude pharmacists covering multiple wards
            );
            
            // Sort band 6/7 pharmacists by how many clinics they've already been assigned to this week
            const sortedBand67Pharmacists = [...band67Pharmacists].sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            console.log(`[generateRota] STRATEGY 5: Found ${band67Pharmacists.length} warfarin-trained band 6/7 pharmacists:`, 
              band67Pharmacists.map(p => p ? { name: p.name, band: p.band, warfarinTrained: p.warfarinTrained } : null).filter(Boolean)
            );
            
            terminalLog(`STRATEGY 5: Found ${band67Pharmacists.length} warfarin-trained band 6/7 pharmacists, sorted by weekly clinic load:`, 
              sortedBand67Pharmacists.map(p => p ? { 
                name: p.name, 
                band: p.band, 
                warfarinTrained: p.warfarinTrained,
                weeklyClinicCount: weeklyClinicCounts[p._id] || 0
              } : null).filter(Boolean)
            );
            
            // Check for time conflicts
            const assignedPharmacistsByTime: Record<string, string[]> = {};
            
            // Get all assigned pharmacists for the current day with their time slots
            const todaysAssignments = assignments.filter(a => a.type === "clinic");
            todaysAssignments.forEach(assignment => {
              const timeKey = `${assignment.startTime}-${assignment.endTime}`;
              if (!assignedPharmacistsByTime[timeKey]) {
                assignedPharmacistsByTime[timeKey] = [];
              }
              assignedPharmacistsByTime[timeKey].push(assignment.pharmacistId);
            });
            
            // Filter out pharmacists who have already been assigned to a conflicting time slot
            const availableBand67Pharmacists = sortedBand67Pharmacists.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            });
            
            if (availableBand67Pharmacists.length > 0) {
              const pharmacist = availableBand67Pharmacists[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 6/7 pharmacist ${pharmacist.name} to clinic ${clinic.name}`);
                
                assignments.push({
                  pharmacistId: pharmacist._id,
                  type: "clinic",
                  location: clinic.name,
                  startTime: clinic.startTime,
                  endTime: clinic.endTime
                });
                
                assigned = true;
              }
            }
          }
          
          // STRATEGY 6: If still not assigned and all pharmacists are covering multiple wards, try to reassign ward coverage
          if (!assigned) {
            console.log(`[generateRota] STRATEGY 6: No pharmacists available for clinic ${clinic.name}, checking if lack of availability is due to multi-ward coverage`);
            
            // Get all warfarin-trained pharmacists, including those covering multiple wards
            const allWarfarinTrainedPharmacists = workingPharmacists.filter(p => 
              p && 
              p.warfarinTrained &&
              !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime)
            );
            
            // Get multi-ward pharmacists
            const multiWardPharmacists = getMultiWardPharmacists(assignments);
            
            // Check if multi-ward pharmacists exist and are warfarin trained
            const multiWardWarfarinPharmacists = allWarfarinTrainedPharmacists.filter(p => 
              p && multiWardPharmacists.has(p._id)
            );
            
            if (multiWardWarfarinPharmacists.length > 0) {
              console.log(`[generateRota] STRATEGY 6: Found ${multiWardWarfarinPharmacists.length} warfarin-trained pharmacists covering multiple wards`);
              
              // Sort by band preference (6, 7, then 8a)
              const sortedMultiWardPharmacists = [...multiWardWarfarinPharmacists].sort((a, b) => {
                if (!a || !b) return 0;
                
                // Prefer band 6, then 7, then 8a
                const bandOrder: Record<string, number> = { "6": 0, "7": 1, "8a": 2 };
                const aBand = a.band || '';
                const bBand = b.band || '';
                
                return (bandOrder[aBand] || 999) - (bandOrder[bBand] || 999);
              });
              
              // Find a non-multi-ward pharmacist who isn't warfarin trained to take over one of their wards
              const bestMultiWardPharmacist = sortedMultiWardPharmacists[0];
              
              if (bestMultiWardPharmacist) {
                // Find which wards this pharmacist is covering
                const coveredWards: string[] = [];
                
                assignments.forEach(a => {
                  if (a.type === "ward" && a.pharmacistId === bestMultiWardPharmacist._id) {
                    coveredWards.push(a.location);
                  }
                });
                
                console.log(`[generateRota] STRATEGY 6: ${bestMultiWardPharmacist.name} is covering multiple wards: ${coveredWards.join(', ')}`);
                
                // Find pharmacists not assigned to any wards but are available
                const availablePharmacists = pharmacists.filter(p => 
                  p && 
                  args.pharmacistIds.includes(p._id) &&
                  p.band !== "EAU Practitioner" &&
                  p.band !== "Dispensary Pharmacist" && // Exclude dispensary pharmacists
                  !assignments.some(a => a.pharmacistId === p._id && (a.type === "ward" || a.type === "clinic")) &&
                  !isPharmacistNotAvailable(p, dayLabel, "09:00", "17:00")
                );
                
                if (availablePharmacists.length > 0) {
                  // Pick one of the covered wards to reassign (preferably the ward they're not primarily responsible for)
                  let wardToReassign = coveredWards[0];
                  
                  // If they have multiple wards, try to find one that's not their primary ward
                  if (coveredWards.length > 1 && bestMultiWardPharmacist.primaryWards) {
                    const nonPrimaryWards = coveredWards.filter(w => !bestMultiWardPharmacist.primaryWards?.includes(w));
                    if (nonPrimaryWards.length > 0) {
                      wardToReassign = nonPrimaryWards[0];
                    }
                  }
                  
                  // Get a replacement pharmacist
                  const replacementPharmacist = availablePharmacists[0];
                  
                  console.log(`[generateRota] STRATEGY 6: Reassigning ward ${wardToReassign} from ${bestMultiWardPharmacist.name} to ${replacementPharmacist?.name || "unknown"}`);
                  
                  // Remove the ward assignment from the multi-ward pharmacist
                  const assignmentIndex = assignments.findIndex(a => 
                    a.type === "ward" && 
                    a.location === wardToReassign && 
                    a.pharmacistId === bestMultiWardPharmacist._id
                  );
                  
                  if (assignmentIndex !== -1 && replacementPharmacist) {
                    assignments.splice(assignmentIndex, 1);
                    
                    // Assign the ward to the replacement pharmacist
                    assignments.push({
                      pharmacistId: replacementPharmacist._id,
                      type: "ward",
                      location: wardToReassign,
                      startTime: "00:00",
                      endTime: "23:59"
                    });
                    
                    // Now assign the clinic to the multi-ward pharmacist
                    assignments.push({
                      pharmacistId: bestMultiWardPharmacist._id,
                      type: "clinic",
                      location: clinic.name,
                      startTime: clinic.startTime,
                      endTime: clinic.endTime
                    });
                    
                    console.log(`[generateRota] STRATEGY 6: SUCCESS! Reassigned ward ${wardToReassign} to ${replacementPharmacist?.name || "unknown"} and assigned ${bestMultiWardPharmacist.name} to clinic ${clinic.name}`);
                    
                    assigned = true;
                  }
                } else {
                  console.log(`[generateRota] STRATEGY 6: No available pharmacists to take over ward duties`);
                }
              }
            } else {
              console.log(`[generateRota] STRATEGY 6: No warfarin-trained pharmacists covering multiple wards`);
            }
            
            // If still not assigned, record it as a conflict
            if (!assigned) {
              console.log(`[generateRota] WARNING: Unable to assign any pharmacist to clinic ${clinic.name}`);
              conflicts.push({
                type: "clinic",
                description: `No eligible pharmacists available for clinic ${clinic.name}`,
                severity: "warning"
              });
            }
          }
          
          // If no pharmacist was assigned, add a warning conflict
          if (!assigned) {
            console.log(`[generateRota] WARNING: Could not assign pharmacist to clinic ${clinic.name}`);
            
            terminalLog(`WARNING: Could not assign pharmacist to clinic ${clinic.name} - No eligible warfarin-trained pharmacists available`);
            
            conflicts.push({
              type: "clinic",
              description: `No warfarin-trained pharmacist available for clinic ${clinic.name}. Escalate to senior team.`,
              severity: "warning"
            });
          }
        }
      }
    }
    
    // Move this to just after clinics assignment and before any dispensary/lunch assignment logic
    const warfarinClinicPharmacists = getWarfarinClinicPharmacists(assignments, clinics);

    // 2. DISPENSARY COVERAGE
    // Operation Time: 9am-5pm, Lunch: 1:30-2:00pm
    const dispensaryShifts = [
      { start: "09:00", end: "11:00" },
      { start: "11:00", end: "13:00" },
      { start: "13:00", end: "15:00" },
      { start: "15:00", end: "17:00" }
    ];
    // Find dispensary pharmacist(s)
    const dispensaryPharmacists = pharmacists.filter(p => 
      p && 
      p.band === "Dispensary Pharmacist" && 
      args.pharmacistIds.includes(p._id) &&
      // Check if this dispensary pharmacist is working today
      !isPharmacistNotAvailable(p, dayLabel, "09:00", "17:00")
    );
    
    if (dispensaryPharmacists.length > 0) {
      // Assign dispensary pharmacist to all shifts except lunch
      const dp = dispensaryPharmacists[0];
      if (dp) {
        dispensaryShifts.forEach(shift => {
          if (!(shift.start === "13:00" && shift.end === "15:00")) { // not lunch
            assignments.push({
              pharmacistId: dp._id,
              type: "dispensary",
              location: "Dispensary",
              startTime: shift.start,
              endTime: shift.end
            });
          }
        });
        
        // Assign lunch cover (13:30-14:00) to another pharmacist
        // Use dispensaryDutyCounts to rotate fairly
        let eligible = pharmacists.filter(p => 
          p && 
          p !== null && 
          args.pharmacistIds.includes(p._id) && 
          p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
          p._id !== dp._id && // Not the main dispensary pharmacist
          !hasClinicConflict(p._id, "13:30", "14:00", assignments) &&
          !isPharmacistNotAvailable(p, dayLabel, "13:30", "14:00") &&
          !warfarinClinicPharmacists.has(p._id)
        );
        
        // Create a prioritized list with zero-duty pharmacists at the front
        let zeroDutyPharmacists: (Doc<"pharmacists"> | null)[] = [];
        let otherEligiblePharmacists: (Doc<"pharmacists"> | null)[] = [];
        
        if (args.dispensaryDutyCounts) {
          // Separate pharmacists who haven't done any dispensary duties yet
          eligible.forEach(p => {
            if (!p) return;
            
            const count = args.dispensaryDutyCounts![p._id as string];
            if (count === 0) {
              zeroDutyPharmacists.push(p);
            } else {
              otherEligiblePharmacists.push(p);
            }
          });
          
          // Sort the other eligible pharmacists by their duty count
          otherEligiblePharmacists = otherEligiblePharmacists.sort((a, b) => {
            if (!a || !b) return 0;
            const aCount = args.dispensaryDutyCounts![a._id as string];
            const bCount = args.dispensaryDutyCounts![b._id as string];
            return aCount - bCount;
          });
          
          // Shuffle within each group to ensure random selection among equals
          zeroDutyPharmacists = shuffleArray(zeroDutyPharmacists);
          otherEligiblePharmacists = shuffleArray(otherEligiblePharmacists);
          
          // Combine the lists with zero-duty pharmacists first
          eligible = [...zeroDutyPharmacists, ...otherEligiblePharmacists];
        }
        
        const lunchCover = eligible[0];
        if (lunchCover) { // Add null check
          assignments.push({
            pharmacistId: lunchCover._id,
            type: "dispensary",
            location: "Dispensary (Lunch Cover)",
            startTime: "13:30",
            endTime: "14:00",
            isLunchCover: true
          });
        } else {
          conflicts.push({
            type: "dispensary",
            description: "No pharmacist available for dispensary lunch cover.",
            severity: "warning"
          });
        }
      }
    } else {
      // Track pharmacists assigned to full-day dispensary duty so they can be excluded from ward assignments
      // const fullDayDispensaryPharmacists = new Set<Id<"pharmacists">>();
      
      // Check if this is a single-pharmacist dispensary day
      const isSinglePharmacistDay = Array.isArray(args.singlePharmacistDispensaryDays) && 
                                    args.singlePharmacistDispensaryDays.includes(args.date);

      if (isSinglePharmacistDay) {
        // Single pharmacist all day with lunch cover mode
        console.log('[generateRota] Using SINGLE pharmacist mode for dispensary on', args.date);
        
        // Get the most junior pharmacist (preferring band 6, then 7, then 8a)
        const getJuniorPharmacists = () => {
          // First try band 6
          let juniors = pharmacists.filter(p => 
            p && 
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            p.band === "6" &&
            !warfarinClinicPharmacists.has(p._id) &&
            !dispensaryShifts.some(shift => 
              hasClinicConflict(p._id, shift.start, shift.end, assignments) || 
              isPharmacistNotAvailable(p, dayLabel, shift.start, shift.end)
            ) &&
            !isSolePharmacistInAnyDirectorate(p._id)
          );
          
          // If no band 6, try band 7
          if (juniors.length === 0) {
            juniors = pharmacists.filter(p => 
              p && 
              args.pharmacistIds.includes(p._id) && 
              p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
              p.band === "7" &&
              !warfarinClinicPharmacists.has(p._id) &&
              !dispensaryShifts.some(shift => 
                hasClinicConflict(p._id, shift.start, shift.end, assignments) || 
                isPharmacistNotAvailable(p, dayLabel, shift.start, shift.end)
              ) &&
              !isSolePharmacistInAnyDirectorate(p._id)
            );
          }
          
          // If no band 7, try band 8a
          if (juniors.length === 0) {
            juniors = pharmacists.filter(p => 
              p && 
              args.pharmacistIds.includes(p._id) && 
              p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
              p.band === "8a" &&
              !warfarinClinicPharmacists.has(p._id) &&
              !dispensaryShifts.some(shift => 
                hasClinicConflict(p._id, shift.start, shift.end, assignments) || 
                isPharmacistNotAvailable(p, dayLabel, shift.start, shift.end)
              ) &&
              !isSolePharmacistInAnyDirectorate(p._id)
            );
          }
          
          // RANDOMIZE among eligible juniors
          juniors = shuffleArray(juniors);
          return juniors[0] || null;
        };
        
        // Get the junior pharmacist to cover all day
        const mainPharmacist = getJuniorPharmacists();
        
        if (mainPharmacist) {
          // Add this pharmacist to the fullDayDispensaryPharmacists set to exclude from ward assignments
          fullDayDispensaryPharmacists.add(mainPharmacist._id);
          console.log(`[generateRota] Pharmacist ${mainPharmacist.name} assigned to full-day dispensary duty in single pharmacist mode - will be excluded from ward assignments`);
          
          // Assign main pharmacist to all shifts except lunch
          dispensaryShifts.forEach(shift => {
            if (!(shift.start === "13:00" && shift.end === "15:00")) { // not lunch
              assignments.push({
                pharmacistId: mainPharmacist._id,
                type: "dispensary",
                location: "Dispensary",
                startTime: shift.start,
                endTime: shift.end
              });
            }
          });
          
          // Handle lunch cover - find someone else for lunch
          // Get eligible pharmacists (excluding the main pharmacist)
          let eligible = pharmacists.filter(p => 
            p && 
            p._id !== mainPharmacist._id &&
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            p.band !== "Dispensary Pharmacist" && // Exclude dispensary pharmacists
            !warfarinClinicPharmacists.has(p._id) &&
            !hasClinicConflict(p._id, "13:30", "14:00", assignments) &&
            !isPharmacistNotAvailable(p, dayLabel, "13:30", "14:00")
          );
          
          // Get zero-duty pharmacists first
          const zeroDutyPharmacists = eligible.filter(p => 
            p && (!args.dispensaryDutyCounts || !args.dispensaryDutyCounts[p._id])
          );
          
          if (zeroDutyPharmacists.length > 0) {
            eligible = zeroDutyPharmacists;
          } else {
            // Sort by duty count
            eligible = eligible.sort((a, b) => {
              if (!a || !b) return 0;
              const aCount = args.dispensaryDutyCounts ? args.dispensaryDutyCounts[a._id as string] || 0 : 0;
              const bCount = args.dispensaryDutyCounts ? args.dispensaryDutyCounts[b._id as string] || 0 : 0;
              return aCount - bCount;
            });
          }
          
          // Shuffle within each group to ensure random selection among equals
          eligible = shuffleArray(eligible);
          
          // Assign lunch cover
          if (eligible.length > 0) {
            const lunchCover = eligible[0];
            if (lunchCover) {
              assignments.push({
                pharmacistId: lunchCover._id,
                type: "dispensary",
                location: "Dispensary (Lunch Cover)",
                startTime: "13:30",
                endTime: "14:00",
                isLunchCover: true
              });
            }
          } else {
            conflicts.push({
              type: "dispensary",
              description: "No pharmacist available for dispensary lunch cover.",
              severity: "warning"
            });
          }
        } else {
          conflicts.push({
            type: "dispensary",
            description: "No pharmacist available for all-day dispensary coverage.",
            severity: "error"
          });
        }
      } else {
        // Simplified randomized approach for dispensary coverage 
        console.log('[generateRota] Using simplified randomized approach for dispensary coverage');
        
        // Use all dispensary shifts - no special handling for lunch
        const regularDispensaryShifts = [...dispensaryShifts];
        
        // Track pharmacists who already have a dispensary shift today to enforce one-shift-per-day rule
        const pharmacistsWithDispensaryShiftToday = new Set<string>();
        
        // For each shift, find eligible pharmacists and randomly select one based on weighting
        for (const shift of regularDispensaryShifts) {
          // Get eligible pharmacists (excluding those with dispensary shifts already today)
          const eligiblePharmacists = pharmacists.filter(p => 
            p && 
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            !pharmacistsWithDispensaryShiftToday.has(p._id) && // Enforce one dispensary shift per day
            !warfarinClinicPharmacists.has(p._id) && // Exclude pharmacists with warfarin clinics today
            !hasClinicConflict(p._id, shift.start, shift.end, assignments) && // No clinic conflicts
            !isPharmacistNotAvailable(p, dayLabel, shift.start, shift.end) && // Available at this time
            !getMultiWardPharmacists(assignments).has(p._id) && // Exclude pharmacists covering multiple wards
            !isSolePharmacistInAnyDirectorate(p._id)
          );
          
          if (eligiblePharmacists.length === 0) {
            console.log(`[generateRota] WARNING: No eligible pharmacists for dispensary shift ${shift.start}-${shift.end}`);
            conflicts.push({
              type: "dispensary",
              description: `No eligible pharmacists available for dispensary shift ${shift.start}-${shift.end}`,
              severity: "warning"
            });
            continue;
          }
          
          // Create a weighted selection array with band 6/7 having twice the chance of band 8a
          const weightedSelection: (Doc<"pharmacists">)[] = [];
          
          eligiblePharmacists.forEach(p => {
            if (!p) return;
            
            // Add each pharmacist to the weighted selection array
            // Band 6/7 pharmacists are added twice (double chance)
            // Band 8a pharmacists are added once (base chance)
            if (p.band === "6" || p.band === "7") {
              weightedSelection.push(p, p); // Add twice for double chance
            } else {
              weightedSelection.push(p); // Add once for normal chance
            }
          });
          
          // Shuffle the weighted selection array for randomization
          const shuffledSelection = shuffleArray(weightedSelection);
          
          // Select the first pharmacist after shuffling
          const selectedPharmacist = shuffledSelection[0];
          
          if (selectedPharmacist) {
            // Make the assignment
            assignments.push({
              pharmacistId: selectedPharmacist._id,
              type: "dispensary",
              location: "Dispensary",
              startTime: shift.start,
              endTime: shift.end
            });
            
            // Add to the set of pharmacists with dispensary shifts today
            pharmacistsWithDispensaryShiftToday.add(selectedPharmacist._id);
            
            console.log(`[generateRota] Assigned ${selectedPharmacist.name} (Band ${selectedPharmacist.band}) to dispensary shift ${shift.start}-${shift.end}`);
          }
        }
      }
    }
    
    // Create a set to track pharmacists assigned to full-day dispensary duty
    // const fullDayDispensaryPharmacists = new Set<Id<"pharmacists">>();

    // Check if this is a single-pharmacist dispensary day
    const isSinglePharmacistDay = Array.isArray(args.singlePharmacistDispensaryDays) && 
                               args.singlePharmacistDispensaryDays.includes(args.date);

    // Check if we need to regenerate the rota due to dispensary mode changes
    if (args.regenerateRota && isSinglePharmacistDay) {
      console.log('[generateRota] Regenerating rota due to dispensary mode changes');
      
      // Look for dispensary assignments that cover the full day
      const dispensaryAssignments = assignments.filter(a => 
        a.type === "dispensary" && 
        a.location === "Dispensary" && 
        !a.location.includes("Lunch Cover")
      );
      
      // Group by pharmacist ID to find who has multiple assignments
      const pharmacistAssignmentCounts: Record<string, number> = {};
      dispensaryAssignments.forEach(a => {
        const id = a.pharmacistId.toString();
        pharmacistAssignmentCounts[id] = (pharmacistAssignmentCounts[id] || 0) + 1;
      });
      
      // If a pharmacist has 3+ dispensary assignments, they're likely on full-day duty
      Object.entries(pharmacistAssignmentCounts).forEach(([id, count]) => {
        if (count >= 3) {
          const pharmacistId = id as unknown as Id<"pharmacists">;
          fullDayDispensaryPharmacists.add(pharmacistId);
          
          // Find the pharmacist name for better logging
          const pharmacist = pharmacists.find(p => p && p._id === pharmacistId);
          console.log(`[generateRota] Pharmacist ${pharmacist?.name || pharmacistId} assigned to full-day dispensary duty - will be excluded from ward assignments`);
        }
      });
      
      // Remove any ward assignments for pharmacists who are now on full-day dispensary duty
      if (fullDayDispensaryPharmacists.size > 0) {
        // Find and remove any existing ward assignments for these pharmacists
        const assignmentsToRemove = assignments.filter(a => 
          a.type === "ward" && 
          fullDayDispensaryPharmacists.has(a.pharmacistId)
        );
        
        if (assignmentsToRemove.length > 0) {
          console.log(`[generateRota] Removing ${assignmentsToRemove.length} ward assignments for pharmacists on full-day dispensary duty`);
          
          // Remove these assignments
          const updatedAssignments = assignments.filter(a => 
            !(a.type === "ward" && fullDayDispensaryPharmacists.has(a.pharmacistId))
          );
          
          // Replace the assignments array with the filtered version
          assignments.length = 0;
          assignments.push(...updatedAssignments);
        }
      }
    }

    // --- 3. WARD ASSIGNMENTS ---
    // Build list of active wards with directorate
    let activeWards = directorates.flatMap(d =>
      d.wards.filter(w => w.isActive).map(w => ({ ...w, directorate: d.name }))
    );
    
    // Reorganize activeWards to prioritize EAU and ITU
    // This ensures excess pharmacists are placed in EAU/ITU instead of Ward 3
    activeWards = [...activeWards].sort((a, b) => {
      // Emergency Assessment Unit gets highest priority
      if (a.name.includes('Emergency Assessment Unit')) return -1;
      if (b.name.includes('Emergency Assessment Unit')) return 1;
      
      // Then ITU
      if (a.name.includes('ITU')) return -1;
      if (b.name.includes('ITU')) return 1;
      
      // Then wards with higher minimum requirements 
      if (a.minPharmacists > b.minPharmacists) return -1;
      if (a.minPharmacists < b.minPharmacists) return 1;
      
      // Then standard order
      return 0;
    });
    
    console.log(`[generateRota] Priority ward processing order: ${activeWards.map(w => w.name).join(', ')}`);
    

    // 3a: Assign EAU Practitioners to EAU ward first
    const eauWard = activeWards.find(w => w.directorate === "EAU");
    if (eauWard) {
      const eauPracs: Doc<"pharmacists">[] = pharmacists.filter(
        (p): p is Doc<"pharmacists"> => p !== null && p.band === "EAU Practitioner"
      );
      for (const p of eauPracs) {
        // Skip if not available
        if (isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) continue;
        assignments.push({ pharmacistId: p._id, type: "ward", location: eauWard.name, startTime: "00:00", endTime: "23:59" });
      }
    }

    // Pool pharmacists eligible for ward duties (exclude dispensary & EAU Practitioner)
    let wardPharmacists = pharmacists.filter(p =>
      p && 
      p.band !== "Dispensary Pharmacist" && p.band !== "EAU Practitioner"
      // Exclude pharmacists assigned to full-day dispensary shifts
      && !fullDayDispensaryPharmacists.has(p._id)
    ) as NonNullable<typeof pharmacists[0]>[];

    // Log excluded pharmacists
    if (fullDayDispensaryPharmacists.size > 0) {
      console.log(`[generateRota] Excluded ${fullDayDispensaryPharmacists.size} pharmacist(s) from ward assignments due to full-day dispensary duty`);
    }

    // Helper to score pharmacist–ward match (lower is better)
    function wardMatchScore(p: any, w: any): number {
      let score = 0;
      if (p.primaryWards?.includes(w.name)) score -= 10;
      if (p.primaryDirectorate === w.directorate) score -= 5;
      if (p.band === "8a") score -= 3;
      if (p.band === "7") score -= 2;
      if (p.band === "6" && p.trainedDirectorates.includes(w.directorate)) score -= 1;
      return score;
    }

    // PASS 1: First assign each pharmacist to their primary directorate/ward if possible
    // Create a copy of ward pharmacists to use for this pass
    let initialAssignmentPharmacists = [...wardPharmacists];
    
    console.log('[generateRota] PASS 1: Starting primary directorate/ward assignment');
    
    // Group wards by directorate for easier access
    const wardsByDirectorate: Record<string, typeof activeWards[number][]> = {};
    activeWards.forEach(w => {
      if (!wardsByDirectorate[w.directorate]) {
        wardsByDirectorate[w.directorate] = [];
      }
      wardsByDirectorate[w.directorate].push(w);
    });
    
    // Track which wards have already been assigned in this pass
    const wardsAlreadyAssigned = new Set<string>();
    
    // First prioritize pharmacists with a primary ward assigned
    const prioritizedPharmacists = [...initialAssignmentPharmacists].sort((a, b) => {
      // First prioritize pharmacists with a primary ward assigned
      const aHasPrimaryWard = a.primaryWards?.length > 0 ? 1 : 0;
      const bHasPrimaryWard = b.primaryWards?.length > 0 ? 1 : 0;
      
      if (aHasPrimaryWard !== bHasPrimaryWard) {
        // Return 1 for "has primary ward" to sort these first
        return bHasPrimaryWard - aHasPrimaryWard;
      }
      
      // Then sort by band (8a first, then 7, then 6)
      const bandPriority: Record<string, number> = { "8a": 0, "7": 1, "6": 2 };
      const aPriority = bandPriority[a.band] || 3;
      const bPriority = bandPriority[b.band] || 3;
      return aPriority - bPriority;
    });
    
    console.log('[generateRota] PASS 1: Pharmacists prioritized - those with primary wards first, then by band');
    
    prioritizedPharmacists.forEach(p => {
      // Only proceed if they have a primary directorate and aren't already assigned
      if (!p.primaryDirectorate || 
          assignments.some(a => a.pharmacistId === p._id && a.type === "ward")) {
        if (!p.primaryDirectorate) {
          console.log(`[generateRota] PASS 1: Skipping ${p.name} - no primary directorate assigned`);
        } else {
          console.log(`[generateRota] PASS 1: Skipping ${p.name} - already assigned to a ward`);
        }
        return;
      }
      
      // Get wards in their primary directorate
      const directorateWards = wardsByDirectorate[p.primaryDirectorate] || [];
      if (directorateWards.length === 0) return;
      
      // Try to find their primary ward first
      let targetWard = directorateWards.find(w => 
        p.primaryWards?.includes(w.name) && !wardsAlreadyAssigned.has(w.name)
      );
      if (targetWard) {
        console.log(`[generateRota] PASS 1: Found primary ward ${targetWard.name} for ${p.name}`);
      } else {
        const alreadyAssignedWards = p.primaryWards.filter(w => wardsAlreadyAssigned.has(w));
        if (alreadyAssignedWards.length > 0) {
          console.log(`[generateRota] PASS 1: Primary ward(s) ${alreadyAssignedWards.join(', ')} for ${p.name} already assigned to someone else`);
        } else {
          console.log(`[generateRota] PASS 1: No primary ward found for ${p.name} in directorate ${p.primaryDirectorate}`);
        }
      }
      
      // If no primary ward or not found, pick the first available ward in their directorate
      if (!targetWard) {
        // Find first unassigned ward in the directorate
        targetWard = directorateWards.find(w => !wardsAlreadyAssigned.has(w.name));
        if (targetWard) {
          console.log(`[generateRota] PASS 1: Assigning ${p.name} to first available ward in directorate: ${targetWard.name}`);
        } else {
          console.log(`[generateRota] PASS 1: No available wards in ${p.primaryDirectorate} for ${p.name} - all already assigned`);
        }
      }
      
      // Skip if pharmacist is not available
      if (isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) {
        console.log(`[generateRota] PASS 1: Skipping ${p.name} - not available on ${dayLabel}`);
        return;
      }
      
      // Special handling for band 6 pharmacists - we should try to "bump" a band 7 from this directorate
      // to make room if possible
      if (!targetWard && p.band === "6") {
        // Check if the Band 6 pharmacist has training in this directorate
        const hasTrainingInDirectorate = Array.isArray(p.trainedDirectorates) && 
                                        p.trainedDirectorates.includes(p.primaryDirectorate);
        
        if (!hasTrainingInDirectorate) {
          console.log(`[generateRota] PASS 1: Band 6 ${p.name} has NO TRAINING in ${p.primaryDirectorate} - checking if we can reassign a band 7`);
        } else {
          console.log(`[generateRota] PASS 1: Band 6 ${p.name} HAS TRAINING in ${p.primaryDirectorate} but no available wards - will NOT reassign a band 7`);
          return; // Skip reassignment since the Band 6 has training in this directorate
        }
        
        // Check for any band 7 pharmacists who have been assigned to this directorate already
        const directorate = p.primaryDirectorate;
        interface PharmacistAssignment {
          assignment: Assignment;
          pharmacist: NonNullable<typeof pharmacists[0]>;
          ward: typeof activeWards[number];
          isPrimaryWard: boolean;
          isDefault: boolean;
        }
        
        const band7PharmacistsInThisDir: PharmacistAssignment[] = assignments
          .filter(a => a.type === "ward")
           .map(a => {
             const ward = activeWards.find(w => w.name === a.location);
             if (ward && ward.directorate === directorate) {
               const pharmacist = pharmacists.find(p => p && p._id === a.pharmacistId);
               if (pharmacist && pharmacist.band === "7") {
                 // Check if this is a primary ward for the pharmacist
                 const isPrimaryWard = pharmacist.primaryWards?.includes(ward.name) || false;
                 // Check if this is a default pharmacist
                 const isDefault = pharmacist.isDefaultPharmacist || false;
                 return { assignment: a, pharmacist, ward, isPrimaryWard, isDefault };
               }
             }
             return null;
           })
           .filter((item): item is PharmacistAssignment => item !== null);
          
        if (band7PharmacistsInThisDir.length > 0) {
          // We found a band 7 pharmacist in this directorate who could be moved
          // Sort band 7 pharmacists by priority to move:
          // 1. First move non-default pharmacists over default ones
          // 2. Then move those not in their primary wards
          const sortedBand7PharmacistsToMove = [...band7PharmacistsInThisDir].sort((a, b) => {
            // First compare default status (non-default first)
            if (a.isDefault !== b.isDefault) {
              return a.isDefault ? 1 : -1; // Move non-default first
            }
            
            // Then compare primary ward status (non-primary ward first)
            if (a.isPrimaryWard !== b.isPrimaryWard) {
              return a.isPrimaryWard ? 1 : -1; // Move non-primary ward first
            }
            
            return 0;
          });
          
          console.log(`[generateRota] PASS 1: Band 7 pharmacists in ${directorate} sorted by priority to move:`, 
            sortedBand7PharmacistsToMove.map(item => 
              `${item.pharmacist.name} (${item.isDefault ? 'DEFAULT' : 'non-default'}, ${item.isPrimaryWard ? 'primary ward' : 'non-primary ward'})`
            )
          );
          
          const targetToReplace = sortedBand7PharmacistsToMove[0];
          const moveReason = targetToReplace.isDefault ? 
            (targetToReplace.isPrimaryWard ? "despite being DEFAULT and in primary ward" : "despite being DEFAULT but not in primary ward") : 
            (targetToReplace.isPrimaryWard ? "non-default but in primary ward" : "non-default and not in primary ward");
          
          console.log(`[generateRota] PASS 1: Found band 7 ${targetToReplace.pharmacist.name} in ${directorate} who could be moved (${moveReason}) to make room for band 6 ${p.name} who has NO TRAINING in this directorate`);
          
          // Remove the band 7's assignment
          const idxToRemove = assignments.findIndex(a => 
            a.pharmacistId === targetToReplace.assignment.pharmacistId && 
            a.location === targetToReplace.assignment.location
          );
          
          if (idxToRemove !== -1) {
            // Remove the assignment
            const removedAssignment = assignments.splice(idxToRemove, 1)[0];
            
            // Make the band 7 pharmacist available for reassignment
            const band7Pharm = targetToReplace.pharmacist;
            wardPharmacists.push(band7Pharm);
            
            // Make the ward available for the band 6 pharmacist
            const wardName = targetToReplace.ward.name;
            wardsAlreadyAssigned.delete(wardName);
            
            // Set the target ward for the band 6 pharmacist
            targetWard = targetToReplace.ward;
            
            console.log(`[generateRota] PASS 1: Reassigning ward ${wardName} from band 7 ${band7Pharm.name} to band 6 ${p.name}`);
          }
        } else {
          console.log(`[generateRota] PASS 1: No band 7 pharmacists found in ${directorate} to reassign`);
        }
      }
      
      if (!targetWard) {
        console.log(`[generateRota] PASS 1: No available wards in ${p.primaryDirectorate} for ${p.name} - all already assigned`);
        return; // Skip this pharmacist if no ward available
      }
      
      // Make the assignment
      assignments.push({
        pharmacistId: p._id,
        type: "ward",
        location: targetWard.name,
        startTime: "00:00",
        endTime: "23:59"
      });
      console.log(`[generateRota] PASS 1: Assigned ${p.name} to ${targetWard.name} in ${targetWard.directorate} directorate`);
      
      // Mark this ward as assigned
      wardsAlreadyAssigned.add(targetWard.name);
      
      // Remove this pharmacist from the pool for future passes
      wardPharmacists = wardPharmacists.filter(pharm => pharm._id !== p._id);
    });
    
    console.log(`[generateRota] PASS 1: Completed. ${wardPharmacists.length} pharmacists remaining unassigned`);

    // PASS 2: Check if any directorates have no assigned pharmacists 
    // and prioritize filling those first (except ITU which can be left empty)
    const directoratesFilled: Record<string, boolean> = {};
    
    // Initialize as all unfilled
    Object.keys(wardsByDirectorate).forEach(dir => {
      directoratesFilled[dir] = false;
    });
    
    // Mark directorates that already have assignments
    assignments.forEach(a => {
      if (a.type === "ward") {
        // Find the directorate for this ward
        const ward = activeWards.find(w => w.name === a.location);
        if (ward) {
          directoratesFilled[ward.directorate] = true;
        }
      }
    });
    
    // It's acceptable for ITU to have no pharmacists
    directoratesFilled["ITU"] = true;
    
    // Fill empty directorates first
    for (const directorate in directoratesFilled) {
      if (directoratesFilled[directorate]) continue; // Skip filled directorates
      
      const dirWards = wardsByDirectorate[directorate] || [];
      if (dirWards.length === 0) continue;
      
      console.log(`[generateRota] PASS 2: Directorate ${directorate} has no pharmacists assigned. Attempting to fill...`);
      
      // Get ALL working pharmacists for the day - this is different from previous version
      // that only looked at unassigned pharmacists
      const allWorkingPharmacists = getWorkingPharmacistsForDay(pharmacists, args, dayOfWeek)
        .filter((p): p is NonNullable<typeof pharmacists[0]> => 
          p !== null && !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")
        );
      
      // STRATEGY 1: First try band 6 pharmacists trained in that directorate
      const band6TrainedCandidates = allWorkingPharmacists
        .filter(p => p && p.band === "6" && (p.trainedDirectorates || []).includes(directorate))
        .sort((a, b) => {
          // First prioritize those not already assigned
          const aAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === a._id);
          const bAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === b._id);
          if (aAssigned !== bAssigned) {
            return aAssigned ? 1 : -1; // Prefer unassigned first
          }
          
          // Check if either is assigned to their primary directorate
          const aAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === a._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === a.primaryDirectorate;
            }
            return false;
          });
          
          const bAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === b._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === b.primaryDirectorate;
            }
            return false;
          });
          
          // If one is assigned to primary and one isn't, prioritize moving the one not assigned to primary
          if (aAssignedToPrimary !== bAssignedToPrimary) {
            return aAssignedToPrimary ? 1 : -1; // Prefer not to move those in primary directorate
          }
          
          // Then consider if either is a default pharmacist
          const aIsDefault = a.isDefaultPharmacist ? 1 : 0;
          const bIsDefault = b.isDefaultPharmacist ? 1 : 0;
          
          // If one is default and one isn't, prioritize moving the non-default
          if (aIsDefault !== bIsDefault) {
            return aIsDefault - bIsDefault; // Lower number gets picked first, so prefer non-default
          }
          
          // Then prioritize those trained in the target directorate
          const aTrainedInDir = (a.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          const bTrainedInDir = (b.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          return aTrainedInDir - bTrainedInDir;
        });
      
      console.log(`[generateRota] PASS 2: Found ${band6TrainedCandidates.length} band 6 pharmacists trained in ${directorate}:`, 
        band6TrainedCandidates.map(p => {
          const isAssigned = assignments.some(a => a.type === "ward" && a.pharmacistId === p._id);
          const isInPrimary = isAssigned && assignments.some(a => {
            if (a.type === "ward" && a.pharmacistId === p._id) {
              const ward = activeWards.find(w => w.name === a.location);
              return ward && ward.directorate === p.primaryDirectorate;
            }
            return false;
          });
          return `${p.name} (${p.isDefaultPharmacist ? 'DEFAULT' : 'non-default'}, ${isAssigned ? (isInPrimary ? 'in primary directorate' : 'assigned elsewhere') : 'unassigned'})`;
        }));
      
      // STRATEGY 2: If no band 6 trained, try band 7 pharmacists trained in that directorate
      const band7TrainedCandidates = allWorkingPharmacists
        .filter(p => p && p.band === "7" && (p.trainedDirectorates || []).includes(directorate))
        .sort((a, b) => {
          // First prioritize those not already assigned
          const aAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === a._id);
          const bAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === b._id);
          if (aAssigned !== bAssigned) {
            return aAssigned ? 1 : -1; // Prefer unassigned first
          }
          
          // Check if either is assigned to their primary directorate
          const aAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === a._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === a.primaryDirectorate;
            }
            return false;
          });
          
          const bAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === b._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === b.primaryDirectorate;
            }
            return false;
          });
          
          // If one is assigned to primary and one isn't, prioritize moving the one not assigned to primary
          if (aAssignedToPrimary !== bAssignedToPrimary) {
            return aAssignedToPrimary ? 1 : -1; // Prefer not to move those in primary directorate
          }
          
          // Then consider if either is a default pharmacist
          const aIsDefault = a.isDefaultPharmacist ? 1 : 0;
          const bIsDefault = b.isDefaultPharmacist ? 1 : 0;
          
          // If one is default and one isn't, prioritize moving the non-default
          if (aIsDefault !== bIsDefault) {
            return aIsDefault - bIsDefault; // Lower number gets picked first, so prefer non-default
          }
          
          // Then prioritize those trained in the target directorate
          const aTrainedInDir = (a.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          const bTrainedInDir = (b.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          return aTrainedInDir - bTrainedInDir;
        });
      
      console.log(`[generateRota] PASS 2: Found ${band7TrainedCandidates.length} band 7 pharmacists trained in ${directorate}:`, 
        band7TrainedCandidates.map(p => {
          const isAssigned = assignments.some(a => a.type === "ward" && a.pharmacistId === p._id);
          const isInPrimary = isAssigned && assignments.some(a => {
            if (a.type === "ward" && a.pharmacistId === p._id) {
              const ward = activeWards.find(w => w.name === a.location);
              return ward && ward.directorate === p.primaryDirectorate;
            }
            return false;
          });
          return `${p.name} (${p.isDefaultPharmacist ? 'DEFAULT' : 'non-default'}, ${isAssigned ? (isInPrimary ? 'in primary directorate' : 'assigned elsewhere') : 'unassigned'})`;
        }));
      
      // STRATEGY 3: If no trained band 6/7, try any band 7
      const band7Candidates = allWorkingPharmacists
        .filter(p => p && p.band === "7")
        .sort((a, b) => {
          // First prioritize those not already assigned
          const aAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === a._id);
          const bAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === b._id);
          if (aAssigned !== bAssigned) {
            return aAssigned ? 1 : -1; // Prefer unassigned first
          }
          
          // Check if either is assigned to their primary directorate
          const aAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === a._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === a.primaryDirectorate;
            }
            return false;
          });
          
          const bAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === b._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === b.primaryDirectorate;
            }
            return false;
          });
          
          // If one is assigned to primary and one isn't, prioritize moving the one not assigned to primary
          if (aAssignedToPrimary !== bAssignedToPrimary) {
            return aAssignedToPrimary ? 1 : -1; // Prefer not to move those in primary directorate
          }
          
          // Then consider if either is a default pharmacist
          const aIsDefault = a.isDefaultPharmacist ? 1 : 0;
          const bIsDefault = b.isDefaultPharmacist ? 1 : 0;
          
          // If one is default and one isn't, prioritize moving the non-default
          if (aIsDefault !== bIsDefault) {
            return aIsDefault - bIsDefault; // Lower number gets picked first, so prefer non-default
          }
          
          // Then prioritize those trained in the target directorate
          const aTrainedInDir = (a.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          const bTrainedInDir = (b.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          return aTrainedInDir - bTrainedInDir;
        });
      
      console.log(`[generateRota] PASS 2: Found ${band7Candidates.length} band 7 pharmacists that could be moved to ${directorate}:`, 
        band7Candidates.map(p => `${p.name} (${p.isDefaultPharmacist ? 'DEFAULT' : 'non-default'}, ${assignments.some(a => a.type === "ward" && a.pharmacistId === p._id) ? 'already assigned' : 'unassigned'})`));
      
      // STRATEGY 4: Last resort, try band 8a pharmacists
      const band8aCandidates = allWorkingPharmacists
        .filter(p => p && p.band === "8a")
        .sort((a, b) => {
          // First prioritize those not already assigned
          const aAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === a._id);
          const bAssigned = assignments.some(asn => asn.type === "ward" && asn.pharmacistId === b._id);
          if (aAssigned !== bAssigned) {
            return aAssigned ? 1 : -1; // Prefer unassigned first
          }
          
          // Check if either is assigned to their primary directorate
          const aAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === a._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === a.primaryDirectorate;
            }
            return false;
          });
          
          const bAssignedToPrimary = assignments.some(asn => {
            if (asn.type === "ward" && asn.pharmacistId === b._id) {
              const ward = activeWards.find(w => w.name === asn.location);
              return ward && ward.directorate === b.primaryDirectorate;
            }
            return false;
          });
          
          // If one is assigned to primary and one isn't, prioritize moving the one not assigned to primary
          if (aAssignedToPrimary !== bAssignedToPrimary) {
            return aAssignedToPrimary ? 1 : -1; // Prefer not to move those in primary directorate
          }
          
          // Check if the target directorate is the pharmacist's primary directorate
          const aIsPrimaryDirectorate = a.primaryDirectorate === directorate;
          const bIsPrimaryDirectorate = b.primaryDirectorate === directorate;
          
          // If one's primary directorate is the target and the other's isn't, prioritize the one whose primary it is
          if (aIsPrimaryDirectorate !== bIsPrimaryDirectorate) {
            return aIsPrimaryDirectorate ? -1 : 1; // Prefer to assign to their primary directorate
          }
          
          // Then consider if either is a default pharmacist
          const aIsDefault = a.isDefaultPharmacist ? 1 : 0;
          const bIsDefault = b.isDefaultPharmacist ? 1 : 0;
          
          // If one is default and one isn't, prioritize keeping default pharmacists in positions
          if (aIsDefault !== bIsDefault) {
            return bIsDefault - aIsDefault; // Higher number (default=1) gets picked first
          }
          
          // Then prioritize those trained in the target directorate
          const aTrainedInDir = (a.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          const bTrainedInDir = (b.trainedDirectorates || []).includes(directorate) ? -1 : 0;
          return aTrainedInDir - bTrainedInDir;
        });
      
      console.log(`[generateRota] PASS 2: Found ${band8aCandidates.length} band 8a pharmacists that could be moved to ${directorate}:`, 
        band8aCandidates.map(p => {
          const isAssigned = assignments.some(a => a.type === "ward" && a.pharmacistId === p._id);
          const isInPrimary = isAssigned && assignments.some(a => {
            if (a.type === "ward" && a.pharmacistId === p._id) {
              const ward = activeWards.find(w => w.name === a.location);
              return ward && ward.directorate === p.primaryDirectorate;
            }
            return false;
          });
          const isPrimaryDirectorate = p.primaryDirectorate === directorate;
          return `${p.name} (${p.isDefaultPharmacist ? 'DEFAULT' : 'non-default'}, ${isPrimaryDirectorate ? 'primary directorate' : 'not primary'}, ${isAssigned ? (isInPrimary ? 'in primary directorate' : 'assigned elsewhere') : 'unassigned'})`;
        }));
      
      // Combine and prioritize all candidates
      const allCandidates = [
        ...band6TrainedCandidates, // First priority: Band 6 trained in directorate
        ...band7TrainedCandidates, // Second priority: Band 7 trained in directorate
        ...band7Candidates.filter(p => !band7TrainedCandidates.some(tp => tp._id === p._id)), // Third: Band 7 not trained
        ...band8aCandidates // Last priority: Band 8a
      ];
      
      if (allCandidates.length > 0) {
        const chosenPharmacist = allCandidates[0];
        const targetWard = dirWards[0]; // Pick first ward in empty directorate
        const targetWardName = targetWard.name;
        
        // Check if pharmacist is already assigned to a ward
        const existingAssignment = assignments.find(a => 
          a.type === "ward" && a.pharmacistId === chosenPharmacist._id);
        
        if (existingAssignment) {
          // Remove existing assignment
          const currentWard = activeWards.find(w => w.name === existingAssignment.location);
          const fromDirectorate = currentWard ? currentWard.directorate : "unknown";
          
          console.log(`[generateRota] PASS 2: Moving ${chosenPharmacist.name} from ${existingAssignment.location} (${fromDirectorate}) to ${targetWardName} (${directorate})`);
          
          // Remove the existing assignment
          const existingIdx = assignments.findIndex(a => 
            a.type === existingAssignment.type && 
            a.location === existingAssignment.location && 
            a.pharmacistId === existingAssignment.pharmacistId
          );
          
          if (existingIdx !== -1) {
            assignments.splice(existingIdx, 1);
            
            // If this was the only pharmacist in that directorate, mark it as unfilled
            if (fromDirectorate !== "unknown") {
              const directorateStillHasPharmacist = assignments.some(a => {
                if (a.type === "ward" && a.pharmacistId === chosenPharmacist._id) {
                  const ward = activeWards.find(w => w.name === a.location);
                  return ward && ward.directorate === fromDirectorate;
                }
                return false;
              });
              
              if (!directorateStillHasPharmacist) {
                directoratesFilled[fromDirectorate] = false;
                console.log(`[generateRota] PASS 2: Directorate ${fromDirectorate} now has no pharmacists and will be processed again`);
              }
            }
          }
        }
        
        // Make the new assignment
        assignments.push({
          pharmacistId: chosenPharmacist._id,
          type: "ward",
          location: targetWardName,
          startTime: "00:00",
          endTime: "23:59"
        });
        
        console.log(`[generateRota] PASS 2: Assigned ${chosenPharmacist.name} (band ${chosenPharmacist.band}${(chosenPharmacist.trainedDirectorates || []).includes(directorate) ? ', trained' : ''}) to ${targetWardName} in empty directorate ${directorate}`);
        
        // Mark directorate as filled
        directoratesFilled[directorate] = true;
      } else {
        console.log(`[generateRota] PASS 2: WARNING - No suitable pharmacists found for empty directorate ${directorate}`);
        conflicts.push({
          type: "emptyDirectorate",
          description: `Directorate ${directorate} has no available pharmacists to assign`,
          severity: "warning"
        });
      }
    }
    
    console.log(`[generateRota] PASS 2: Completed. ${wardPharmacists.length} pharmacists remaining unassigned`);

    // PASS 3: Ensure minimum pharmacists per ward
    for (const w of activeWards) {
      let assignedCount = 0;
      const wardAssignments = assignments.filter(a => a.type === "ward" && a.location === w.name);
      
      // Count each assignment, with EAU Practitioners counting as 0.5
      for (const assignment of wardAssignments) {
        const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
        
        if (pharmacist) {
          if (pharmacist.band === "EAU Practitioner") {
            // EAU Practitioners count as 0.5
            assignedCount += 0.5;
          } else {
            // Regular pharmacists count as 1
            assignedCount += 1;
          }
        }
      }
      
      console.log(`[generateRota] PASS 3: Ward ${w.name} has ${assignedCount} pharmacist equivalents (minimum required: ${Math.ceil(w.minPharmacists)})`);
      
      while (assignedCount < Math.ceil(w.minPharmacists)) {
        const candidates = wardPharmacists
          .filter(p => !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59"))
          .filter(p => p.band !== "8a" || p.primaryDirectorate === w.directorate)
          .sort((a, b) => wardMatchScore(a, w) - wardMatchScore(b, w));
        const chosen = candidates.shift();
        if (!chosen) break;
        assignments.push({ pharmacistId: chosen._id, type: "ward", location: w.name, startTime: "00:00", endTime: "23:59" });
        wardPharmacists = wardPharmacists.filter(p => p._id !== chosen._id);
        assignedCount++;
      }
    }

    // PASS 4: Top-up to ideal pharmacists per ward evenly
    let wardIndex = 0;
    while (wardPharmacists.length > 0) {
      const w = activeWards[wardIndex % activeWards.length];
      let count = 0;
      const wardAssignments = assignments.filter(a => a.type === "ward" && a.location === w.name);
      
      // Count each assignment, with EAU Practitioners counting as 0.5
      for (const assignment of wardAssignments) {
        const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
        
        if (pharmacist) {
          if (pharmacist.band === "EAU Practitioner") {
            // EAU Practitioners count as 0.5
            count += 0.5;
          } else {
            // Regular pharmacists count as 1
            count += 1;
          }
        }
      }
      
      if (count < w.idealPharmacists) {
        const candidates = wardPharmacists
          .filter(p => !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59"))
          .filter(p => p.band !== "8a" || p.primaryDirectorate === w.directorate)
          .sort((a, b) => wardMatchScore(a, w) - wardMatchScore(b, w));
        const chosen = candidates.shift();
        if (!chosen) break;
        assignments.push({ pharmacistId: chosen._id, type: "ward", location: w.name, startTime: "00:00", endTime: "23:59" });
        wardPharmacists = wardPharmacists.filter(p => p._id !== chosen._id);
      }
      wardIndex++;
      if (wardIndex > activeWards.length * 2) break;
    }

    console.log(`[generateRota] PASS 4: Completed. ${wardPharmacists.length} pharmacists remaining unassigned`);

    // PASS 4.5: Assign remaining pharmacists with no primary ward to ANY ward
    console.log('[generateRota] PASS 4.5: Finding wards for unassigned pharmacists');
    
    // First, check if any directorates are still unfilled
    const currentDirectoratesFilled: Record<string, boolean> = {};
    
    // Initialize as all unfilled
    Object.keys(wardsByDirectorate).forEach(dir => {
      currentDirectoratesFilled[dir] = false;
    });
    
    // Mark directorates that have assignments
    assignments.forEach(a => {
      if (a.type === "ward") {
        const ward = activeWards.find(w => w.name === a.location);
        if (ward) {
          currentDirectoratesFilled[ward.directorate] = true;
        }
      }
    });
    
    // It's still acceptable for ITU to have no pharmacists
    currentDirectoratesFilled["ITU"] = true;
    
    // Log current directorate status
    Object.keys(currentDirectoratesFilled).forEach(dir => {
      console.log(`[generateRota] PASS 4.5: Directorate ${dir} is ${currentDirectoratesFilled[dir] ? 'filled' : 'STILL EMPTY'}`);
    });
    
    // First, place unassigned pharmacists in any unfilled directorates
    for (const directorate in currentDirectoratesFilled) {
      if (currentDirectoratesFilled[directorate]) continue; // Skip filled directorates
      
      const dirWards = wardsByDirectorate[directorate] || [];
      if (dirWards.length === 0) continue;
      
      // Try to find any available pharmacist
      if (wardPharmacists.length > 0) {
        // Sort by those who have training for this directorate
        const candidates = wardPharmacists
          .filter(p => !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59"))
          .filter(p => p.band !== "8a" || p.primaryDirectorate === directorate)
          .sort((a, b) => {
            const aTrainedInDir = (a.trainedDirectorates || []).includes(directorate) ? -10 : 0;
            const bTrainedInDir = (b.trainedDirectorates || []).includes(directorate) ? -10 : 0;
            return (aTrainedInDir - bTrainedInDir);
          });
        
        if (candidates.length > 0) {
          const chosenPharmacist = candidates[0];
          const targetWard = dirWards[0]; // Pick first ward in empty directorate
          
          assignments.push({
            pharmacistId: chosenPharmacist._id,
            type: "ward",
            location: targetWard.name,
            startTime: "00:00",
            endTime: "23:59"
          });
          
          console.log(`[generateRota] PASS 4.5: Assigned ${chosenPharmacist.name} to STILL EMPTY directorate ${directorate} (ward: ${targetWard.name})`);
          
          wardPharmacists = wardPharmacists.filter(p => p._id !== chosenPharmacist._id);
          currentDirectoratesFilled[directorate] = true;
        }
      }
    }
    
    // Then, assign any remaining unassigned pharmacists to ANY ward
    const remainingPharmacistsSorted = [...wardPharmacists].sort((a, b) => {
      // Never move Band 8a pharmacists outside their primary directorate
      if (a.band === "8a" && b.band !== "8a") return 1; // Push 8a to end of list
      if (a.band !== "8a" && b.band === "8a") return -1;
      
      // After ensuring 8a are last, prioritize Band 7 over Band 6
      if (a.band === "7" && b.band === "6") return -1;
      if (a.band === "6" && b.band === "7") return 1;
      
      // If same band, prioritize non-default pharmacists
      if (a.band === b.band) {
        const aIsDefault = a.isDefaultPharmacist || false;
        const bIsDefault = b.isDefaultPharmacist || false;
        if (aIsDefault !== bIsDefault) {
          return aIsDefault ? 1 : -1; // Non-default first
        }
      }
      
      return 0;
    });
    
    console.log(`[generateRota] PASS 4.5: Sorting remaining pharmacists to prioritize non-default and band 7 for movement:`, 
      remainingPharmacistsSorted.map(p => `${p.name} (${p.isDefaultPharmacist ? 'DEFAULT' : 'non-default'}, Band ${p.band})`));
    
    for (const p of remainingPharmacistsSorted) {
      if (isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) {
        console.log(`[generateRota] PASS 4.5: Skipping ${p.name} - not available on ${dayLabel}`);
        continue;
      }
      
      console.log(`[generateRota] PASS 4.5: Finding ANY suitable ward for ${p.name}`);
      
      // Try to find any ward that needs staffing below ideal count, prioritizing trained directorates
      let assigned = false;
      
      // Never move Band 8a pharmacists outside their primary directorate
      if (p.band === "8a") {
        const primaryDirWards = wardsByDirectorate[p.primaryDirectorate || ""] || [];
        if (primaryDirWards.length > 0) {
          console.log(`[generateRota] PASS 4.5: Band 8a ${p.name} can only be assigned to primary directorate ${p.primaryDirectorate}`);
          
          // Try to assign to any ward in primary directorate
          for (const w of primaryDirWards) {
            const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
            if (count < w.idealPharmacists) {
              assignments.push({
                pharmacistId: p._id,
                type: "ward",
                location: w.name,
                startTime: "00:00",
                endTime: "23:59"
              });
              console.log(`[generateRota] PASS 4.5: Assigned Band 8a ${p.name} to ${w.name} in primary directorate ${p.primaryDirectorate}`);
              assigned = true;
              break;
            }
          }
          
          // If we couldn't assign the 8a in their primary directorate, assign to Management Time
          if (!assigned) {
            // Only assign default pharmacists to Management Time
            if (p.isDefaultPharmacist) {
              console.log(`[generateRota] PASS 4.5: No available wards in ${p.primaryDirectorate} for Band 8a ${p.name} - assigning to Management Time`);
              
              // Assign to Management Time instead
              assignments.push({
                pharmacistId: p._id,
                type: "management",
                location: "Management Time",
                startTime: "00:00",
                endTime: "23:59"
              });
              
              assigned = true;
              console.log(`[generateRota] PASS 4.5: Assigned DEFAULT Band 8a ${p.name} to Management Time`);
            } else {
              console.log(`[generateRota] PASS 4.5: No available wards in ${p.primaryDirectorate} for NON-DEFAULT Band 8a ${p.name} - assigning to Management Time`);
              
              // Assign non-default Band 8a to Management Time as well
              assignments.push({
                pharmacistId: p._id,
                type: "management",
                location: "Management Time",
                startTime: "00:00",
                endTime: "23:59"
              });
              
              assigned = true;
              console.log(`[generateRota] PASS 4.5: Assigned NON-DEFAULT Band 8a ${p.name} to Management Time`);
              // NOTE: Will handle management time assignment for non-default 8a's after all clinical slots are filled.
            }
          }
          
          // Remove from pool regardless of assignment - we don't want 8a's assigned elsewhere
          wardPharmacists = wardPharmacists.filter(pharm => pharm._id !== p._id);
          continue;
        }
      }
      
      // For other bands - try to find any ward in a directorate they're trained for
      if (p.band !== "8a" && p.trainedDirectorates && p.trainedDirectorates.length > 0) {
        for (const dir of p.trainedDirectorates) {
          const dirWards = wardsByDirectorate[dir] || [];
          for (const w of dirWards) {
            const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
            if (count < w.idealPharmacists) {
              assignments.push({
                pharmacistId: p._id,
                type: "ward",
                location: w.name,
                startTime: "00:00",
                endTime: "23:59"
              });
              assigned = true;
              break;
            }
          }
          if (assigned) break;
        }
      }
      
      // If still not assigned, try any ward with less than ideal staffing
      if (!assigned) {
        for (const w of activeWards) {
          const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
          if (count < w.idealPharmacists) {
            assignments.push({
              pharmacistId: p._id,
              type: "ward",
              location: w.name,
              startTime: "00:00",
              endTime: "23:59"
            });
            assigned = true;
            break;
          }
        }
      }
      
      // If STILL not assigned, just put them anywhere
      if (!assigned && activeWards.length > 0) {
        const w = activeWards[0]; // Just pick the first ward
        assignments.push({
          pharmacistId: p._id,
          type: "ward",
          location: w.name,
          startTime: "00:00",
          endTime: "23:59"
        });
        console.log(`[generateRota] PASS 4.5: FORCED assignment of ${p.name} to ${w.name} to ensure placement`);
        assigned = true;
      }
      
      if (assigned) {
        wardPharmacists = wardPharmacists.filter(pharm => pharm._id !== p._id);
      }
    }
    
    console.log(`[generateRota] PASS 4.5: Completed. ${wardPharmacists.length} pharmacists STILL unassigned (likely unavailable on ${dayLabel})`);

    // PASS 5: Assign remaining pharmacists with no primary ward to their primary directorate if possible
    for (const p of [...wardPharmacists]) {
      if (!p.primaryDirectorate || isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) continue;
      
      const dirWards = wardsByDirectorate[p.primaryDirectorate] || [];
      if (dirWards.length === 0) continue;
      
      // Sort wards by preference (primary wards first, then others)
      const sortedWards = [...dirWards].sort((a, b) => {
        // Check if pharmacist is trained in either directorate
        const aIsPrimary = p.primaryWards?.includes(a.name);
        const bIsPrimary = p.primaryWards?.includes(b.name);
        
        if (aIsPrimary && !bIsPrimary) return -1; // Prefer primary wards
        if (!aIsPrimary && bIsPrimary) return 1;
        
        return 0;
      });
      
      // Assign to first preferred ward that's below ideal count
      let assigned = false;
      for (const w of sortedWards) {
        const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
        if (count < w.idealPharmacists) {
          assignments.push({
            pharmacistId: p._id,
            type: "ward",
            location: w.name,
            startTime: "00:00",
            endTime: "23:59"
          });
          assigned = true;
          break;
        }
      }
      
      // If assigned, remove from pool
      if (assigned) {
        wardPharmacists = wardPharmacists.filter(pharm => pharm._id !== p._id);
      }
    }

    // PASS 6: Top-up to ideal pharmacists per ward evenly with any remaining pharmacists
    wardIndex = 0;
    while (wardPharmacists.length > 0) {
      const w = activeWards[wardIndex % activeWards.length];
      let count = 0;
      const wardAssignments = assignments.filter(a => a.type === "ward" && a.location === w.name);
      
      // Count each assignment, with EAU Practitioners counting as 0.5
      for (const assignment of wardAssignments) {
        const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
        
        if (pharmacist) {
          if (pharmacist.band === "EAU Practitioner") {
            // EAU Practitioners count as 0.5
            count += 0.5;
          } else {
            // Regular pharmacists count as 1
            count += 1;
          }
        }
      }
      
      if (count < w.idealPharmacists) {
        const candidates = wardPharmacists
          .filter(p => !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59"))
          .filter(p => p.band !== "8a" || p.primaryDirectorate === w.directorate)
          .sort((a, b) => wardMatchScore(a, w) - wardMatchScore(b, w));
        const chosen = candidates.shift();
        if (!chosen) break;
        assignments.push({ pharmacistId: chosen._id, type: "ward", location: w.name, startTime: "00:00", endTime: "23:59" });
        wardPharmacists = wardPharmacists.filter(p => p._id !== chosen._id);
      }
      wardIndex++;
      if (wardIndex > activeWards.length * 2) break;
    }

    console.log(`[generateRota] PASS 6: Completed. ${wardPharmacists.length} pharmacists remaining unassigned`);

    // --- PASS 6.5: PRIORITIZE BAND 6/7 AND DISPLACE BAND 8A TO MANAGEMENT TIME ---
    console.log(`[generateRota] PASS 6.5: Prioritizing Band 6/7 for clinical care and displacing Band 8a to management time when possible`);
    
    // Group all directorates with their assigned pharmacists
    const directorateAssignments: Record<string, { 
      assignments: Assignment[], 
      pharmacists: Array<NonNullable<typeof pharmacists[0]>>,
      wards: typeof activeWards
    }> = {};
    
    // Initialize all directorates
    for (const directorate of directorates) {
      directorateAssignments[directorate.name] = {
        assignments: [],
        pharmacists: [],
        wards: activeWards.filter(w => w.directorate === directorate.name)
      };
    }
    
    // Collect ward assignments by directorate
    for (const assignment of assignments.filter(a => a.type === "ward")) {
      const ward = activeWards.find(w => w.name === assignment.location);
      if (!ward || !ward.directorate) continue;
      
      const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
      if (!pharmacist) continue;
      
      directorateAssignments[ward.directorate].assignments.push(assignment);
      directorateAssignments[ward.directorate].pharmacists.push(pharmacist);
    }
    
    // Process each directorate
    for (const [directorate, data] of Object.entries(directorateAssignments)) {
      console.log(`[generateRota] PASS 6.5: Analyzing directorate ${directorate}`);
      
      // Count pharmacists by band
      const band8aPharmacists = data.pharmacists.filter(p => p.band === "8a");
      const band7Pharmacists = data.pharmacists.filter(p => p.band === "7");
      const band6Pharmacists = data.pharmacists.filter(p => p.band === "6");
      
      console.log(`[generateRota] PASS 6.5: Directorate ${directorate} has ${band8aPharmacists.length} Band 8a, ${band7Pharmacists.length} Band 7, and ${band6Pharmacists.length} Band 6 pharmacists assigned`);
      
      // Calculate how many pharmacists are needed for this directorate
      const wardsInDirectorate = data.wards;
      const totalIdealPharmacists = wardsInDirectorate.reduce((sum, ward) => sum + ward.idealPharmacists, 0);
      const totalMinPharmacists = wardsInDirectorate.reduce((sum, ward) => sum + ward.minPharmacists, 0);
      
      console.log(`[generateRota] PASS 6.5: Directorate ${directorate} needs ${totalMinPharmacists} pharmacists minimum, ${totalIdealPharmacists} ideally`);
      
      // Check if we have at least one Band 7 pharmacist
      const hasBand7 = band7Pharmacists.length > 0;
      
      // Count all pharmacists who aren't Band 8a
      const totalNon8aCoverage = data.pharmacists.filter(p => p.band !== "8a").length;
      
      // Move 8a to management if either:
      // 1. Lower bands (6+7) meet the ideal coverage, OR
      // 2. We have at least one Band 7 AND enough other pharmacists to meet minimum needs
      const lowerBandCoverage = band7Pharmacists.length + band6Pharmacists.length;
      const sufficientCoverage = 
        (lowerBandCoverage >= totalIdealPharmacists) || 
        (hasBand7 && totalNon8aCoverage >= totalMinPharmacists);
      
      if (sufficientCoverage && band8aPharmacists.length > 0) {
        console.log(`[generateRota] PASS 6.5: Directorate ${directorate} has ${lowerBandCoverage} Band 6/7 pharmacists, which is sufficient to meet ideal coverage of ${totalIdealPharmacists}`);
        
        // Move Band 8a to management time
        for (const pharmacist of band8aPharmacists) {
          console.log(`[generateRota] PASS 6.5: Moving Band 8a pharmacist ${pharmacist.name} to management time as lower bands provide sufficient coverage`);
          
          // Find and remove ward assignments for this 8a pharmacist
          const assignmentIndices = [];
          for (let i = 0; i < assignments.length; i++) {
            if (assignments[i].type === "ward" && assignments[i].pharmacistId === pharmacist._id) {
              assignmentIndices.push(i);
            }
          }
          
          // Remove from highest index to lowest to avoid reindexing issues
          for (let i = assignmentIndices.length - 1; i >= 0; i--) {
            assignments.splice(assignmentIndices[i], 1);
          }
          
          // Add management time assignment
          assignments.push({
            pharmacistId: pharmacist._id,
            type: "management",
            location: "Management Time",
            startTime: "00:00",
            endTime: "23:59"
          });
        }
      } else {
        console.log(`[generateRota] PASS 6.5: Directorate ${directorate} - Not moving Band 8a to management. Coverage: ${totalNon8aCoverage} non-8a pharmacists (${band7Pharmacists.length} Band 7, ${band6Pharmacists.length} Band 6). Requirements: min ${totalMinPharmacists}, ideal ${totalIdealPharmacists}.`);
      }
    }
    
    console.log(`[generateRota] PASS 6.5: Completed. Prioritized Band 6/7 for clinical care where possible.`);

// --- CUSTOM: Assign non-default Band 8a pharmacists to management time if all clinical slots are filled ---
const assignedPharmacistIds = new Set(assignments.map(a => a.pharmacistId));
const allClinicalAssignments = assignments.filter(a => a.type === "ward" || a.type === "clinic" || a.type === "dispensary");
const allClinicalSlotsFilled = (() => {
  // If every ward, clinic, and dispensary slot is covered (by count)
  // For simplicity, check that for each active ward, count >= idealPharmacists
  let allWardsCovered = activeWards.every(w => {
    const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
    return count >= w.idealPharmacists;
  });
  // For clinics and dispensary, assume all slots are filled if no unassigned pharmacists remain except Band 8a
  return allWardsCovered;
})();
if (allClinicalSlotsFilled) {
  const unassignedNonDefault8a = pharmacists.filter(p =>
  p &&
  p.band === "8a" &&
  !p.isDefaultPharmacist &&
  !assignedPharmacistIds.has(p._id) &&
  !assignments.some(a => a.pharmacistId === p._id && a.type === "management")
);
for (const p of unassignedNonDefault8a) {
  if (!p) continue;
  assignments.push({
    pharmacistId: p._id,
    type: "management",
    location: "Management Time",
    startTime: "00:00",
    endTime: "23:59"
  });
  console.log(`[generateRota] CUSTOM: Assigned NON-DEFAULT Band 8a ${p.name} to Management Time (all clinical slots filled)`);
}
}

    // --- PASS 7: UTILIZE MANAGEMENT TIME PHARMACISTS FOR UNCOVERED WARDS ---
    console.log(`[generateRota] PASS 7: Starting - Checking for management time pharmacists to cover empty wards`);
    
    // Step 1: Identify all uncovered wards
    const coveredWardNames = new Set(
      assignments
        .filter(a => a.type === "ward")
        .map(a => a.location)
    );

    // Get all active wards
    const allWards = activeWards.map(w => w.name);

    // Find uncovered wards
    const uncoveredWards = allWards.filter(w => !coveredWardNames.has(w));

    console.log(`[generateRota] PASS 7: Found ${uncoveredWards.length} uncovered wards:`, 
      uncoveredWards.map(w => `${w} (${activeWards.find(ward => ward.name === w)?.directorate || 'unknown'})`));
    
    if (uncoveredWards.length > 0) {
      // Step 2: Find pharmacists on management time
      const managementAssignments = assignments.filter(a => a.type === "management");
      
      console.log(`[generateRota] PASS 7: Found ${managementAssignments.length} pharmacists on management time`);

      // Gather all information about uncovered wards
      const uncoveredWardDetails = uncoveredWards.map(wardName => {
        const wardObj = activeWards.find(w => w.name === wardName);
        return {
          name: wardName,
          directorate: wardObj?.directorate || '',
          ward: wardObj
        };
      });
      
      // First, check if any management time pharmacists have an uncovered ward as their primary ward
      console.log(`[generateRota] PASS 7: OPTIMIZATION - First attempting direct assignment to primary wards without displacement`);
      
      let directAssignmentsMade = 0;
      // Process each management assignment first for direct assignment to uncovered wards
      for (const mgmtAssignment of [...managementAssignments]) {
        // Skip if no more uncovered wards
        if (uncoveredWards.length === 0) break;
        
        const pharmacist = pharmacists.find(p => p && p._id === mgmtAssignment.pharmacistId);
        if (!pharmacist) continue;
        
        // Check if this pharmacist has any of the uncovered wards as their primary wards
        if (pharmacist.primaryWards) {
          for (const primaryWard of pharmacist.primaryWards) {
            if (uncoveredWards.includes(primaryWard)) {
              console.log(`[generateRota] PASS 7: DIRECT MATCH - ${pharmacist.name} has uncovered ward ${primaryWard} as primary ward`);
              
              // Remove from management time
              const mgmtIndex = assignments.findIndex(a => 
                a.type === "management" && a.pharmacistId === pharmacist._id
              );
              
              if (mgmtIndex !== -1) {
                assignments.splice(mgmtIndex, 1);
              }
              
              // Assign directly to uncovered ward
              assignments.push({
                pharmacistId: pharmacist._id,
                type: "ward",
                location: primaryWard,
                startTime: "00:00",
                endTime: "23:59"
              });
              
              // Update uncovered wards list
              const uncoveredIndex = uncoveredWards.indexOf(primaryWard);
              if (uncoveredIndex !== -1) {
                uncoveredWards.splice(uncoveredIndex, 1);
              }
              
              directAssignmentsMade++;
              console.log(`[generateRota] PASS 7: Directly assigned ${pharmacist.name} from management time to primary ward ${primaryWard}`);
              break; // Process next pharmacist
            }
          }
        }
      }
      
      console.log(`[generateRota] PASS 7: Made ${directAssignmentsMade} direct assignments to primary wards`);
      
      // SPECIAL OPTIMIZATION: Prioritize moving Band 8a default pharmacists to management time
      // if we have enough staff to cover all wards
      console.log(`[generateRota] PASS 7.2: OPTIMIZATION - Prioritizing Band 8a default pharmacists for management time`);
      
      // 1. Identify overstaffed wards (more than ideal pharmacists assigned)
      const wardAssignmentCounts: Record<string, Array<{assignment: Assignment, pharmacist: NonNullable<typeof pharmacists[0]>}>> = {};
      
      // Count ward assignments and gather pharmacist info
      for (const assignment of assignments.filter(a => a.type === "ward")) {
        const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
        if (!pharmacist) continue;
        
        if (!wardAssignmentCounts[assignment.location]) {
          wardAssignmentCounts[assignment.location] = [];
        }
        
        wardAssignmentCounts[assignment.location].push({
          assignment,
          pharmacist
        });
      }
      
      // Find overstaffed wards
      const overstaffedWards: Array<{ward: typeof activeWards[0], assignments: Array<{assignment: Assignment, pharmacist: NonNullable<typeof pharmacists[0]>}>, excess: number}> = [];
      
      for (const [wardName, assignments] of Object.entries(wardAssignmentCounts)) {
        const ward = activeWards.find(w => w.name === wardName);
        if (!ward) continue;
        
        const idealCount = ward.idealPharmacists;
        const actualCount = assignments.length;
        
        if (actualCount > idealCount) {
          // This ward has more pharmacists than needed
          overstaffedWards.push({
            ward,
            assignments,
            excess: actualCount - idealCount
          });
        }
      }
      
      console.log(`[generateRota] PASS 7.2: Found ${overstaffedWards.length} overstaffed wards: ${overstaffedWards.map(w => `${w.ward.name} (excess: ${w.excess})`)}`);
      
      // 2. Check if any Band 8a default pharmacists are assigned to wards
      const band8aOnWards: Array<{ward: typeof activeWards[0], pharmacist: NonNullable<typeof pharmacists[0]>, assignment: Assignment}> = [];
      
      for (const assignment of assignments.filter(a => a.type === "ward")) {
        const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
        if (!pharmacist) continue;
        
        // Is this a default Band 8a pharmacist?
        if (pharmacist.band === "8a" && pharmacist.isDefaultPharmacist) {
          const ward = activeWards.find(w => w.name === assignment.location);
          if (!ward) continue;
          
          band8aOnWards.push({
            ward,
            pharmacist,
            assignment
          });
        }
      }
      
      console.log(`[generateRota] PASS 7.2: Found ${band8aOnWards.length} default Band 8a pharmacists assigned to wards: ${band8aOnWards.map(b => `${b.pharmacist.name} (${b.ward.name})`)}`);
      
      // 3. Try to optimize by moving Band 8a pharmacists to management time
      let optimizationsMade = 0;
      
      for (const band8aData of band8aOnWards) {
        // Skip if no overstaffed wards with excess pharmacists
        if (overstaffedWards.length === 0 || overstaffedWards.every(w => w.excess <= 0)) {
          console.log(`[generateRota] PASS 7.2: No more excess pharmacists available from overstaffed wards`);
          break;
        }
        
        console.log(`[generateRota] PASS 7.2: Attempting to move Band 8a ${band8aData.pharmacist.name} from ${band8aData.ward.name} to management time`);
        
        // Find best pharmacist to take over Band 8a's ward
        let bestReplacement = null;
        let bestReplacementSource = null;
        
        // Check each overstaffed ward for potential replacements
        for (const overstaffedData of overstaffedWards) {
          // Skip if no excess pharmacists
          if (overstaffedData.excess <= 0) continue;
          
          // Find pharmacists who can cover the Band 8a's ward
          for (const {pharmacist, assignment} of overstaffedData.assignments) {
            // Skip if this is ANY Band 8a pharmacist - regardless of default status
            // Band 8a pharmacists should never be used as replacements for other Band 8a
            if (pharmacist.band === "8a") {
              console.log(`[generateRota] PASS 7.2: Skipping ${pharmacist.name} as potential replacement - Band 8a pharmacists should not be used as replacements`);
              continue;
            }
            
            // Special protection for EAU practitioners
            if (pharmacist.band === "EAU Practitioner") {
              if (assignment.location.includes("Emergency") || assignment.location.includes("EAU")) {
                console.log(`[generateRota] PASS 7.2: Skipping ${pharmacist.name} - EAU Practitioners should remain in Emergency Assessment Unit`);
                continue;
              }
            }
            
            // Skip if this is a pharmacist on their primary ward
            const isPrimaryWard = pharmacist.primaryWards?.includes(assignment.location) || false;
            if (isPrimaryWard) {
              console.log(`[generateRota] PASS 7.2: Skipping ${pharmacist.name} - currently assigned to primary ward ${assignment.location}`);
              continue;
            }
            
            // Check if pharmacist has training for the target directorate
            const hasDirectorateTraining = pharmacist.trainedDirectorates?.includes(band8aData.ward.directorate) || false;
            const isPrimaryDirectorate = pharmacist.primaryDirectorate === band8aData.ward.directorate;
            
            // If trained in the directorate or it's their primary directorate, they can be a replacement
            if (hasDirectorateTraining || isPrimaryDirectorate) {
              // Found suitable replacement
              bestReplacement = {pharmacist, assignment};
              bestReplacementSource = overstaffedData;
              console.log(`[generateRota] PASS 7.2: Selected ${pharmacist.name} as potential replacement - has ${isPrimaryDirectorate ? 'primary directorate' : 'directorate training'} for ${band8aData.ward.directorate}`);
              break;
            }
          }
          
          if (bestReplacement) break; // Found a replacement
        }
        
        // If we found a suitable replacement, make the swap
        if (bestReplacement && bestReplacementSource) {
          console.log(`[generateRota] PASS 7.2: Found replacement ${bestReplacement.pharmacist.name} from ${bestReplacementSource.ward.name} to replace Band 8a ${band8aData.pharmacist.name} on ${band8aData.ward.name}`);
          
          // 1. Remove Band 8a from their ward
          const band8aIndex = assignments.findIndex(a => 
            a.pharmacistId === band8aData.pharmacist._id && 
            a.location === band8aData.ward.name && 
            a.type === "ward"
          );
          
          if (band8aIndex !== -1) {
            assignments.splice(band8aIndex, 1);
          }
          
          // 2. Remove replacement pharmacist from their ward
          const replacementIndex = assignments.findIndex(a => 
            a.pharmacistId === bestReplacement.pharmacist._id && 
            a.location === bestReplacementSource.ward.name && 
            a.type === "ward"
          );
          
          if (replacementIndex !== -1) {
            assignments.splice(replacementIndex, 1);
          }
          
          // 3. Assign replacement to Band 8a's ward
          assignments.push({
            pharmacistId: bestReplacement.pharmacist._id,
            type: "ward",
            location: band8aData.ward.name,
            startTime: "00:00",
            endTime: "23:59"
          });
          
          // 4. Assign Band 8a to management time
          assignments.push({
            pharmacistId: band8aData.pharmacist._id,
            type: "management",
            location: "Management Time",
            startTime: "00:00",
            endTime: "23:59"
          });
          
          // Update counters
          bestReplacementSource.excess--;
          optimizationsMade++;
          
          console.log(`[generateRota] PASS 7.2: Successfully moved Band 8a ${band8aData.pharmacist.name} to management time by replacing with ${bestReplacement.pharmacist.name}`);
        } else {
          console.log(`[generateRota] PASS 7.2: Could not find suitable replacement for Band 8a ${band8aData.pharmacist.name} on ${band8aData.ward.name}`);
        }
      }
      
      console.log(`[generateRota] PASS 7.2: Made ${optimizationsMade} Band 8a optimizations for management time`);
      
      // Refresh management assignments list after optimizations
      const remainingMgmtAssignments = assignments.filter(a => a.type === "management");
      
      // Now process management time pharmacists for potential displacements, but with smarter logic
      for (const mgmtAssignment of remainingMgmtAssignments) {
        // Skip if no more uncovered wards
        if (uncoveredWards.length === 0) break;
        
        const managementPharmacist = pharmacists.find(p => p && p._id === mgmtAssignment.pharmacistId);
        if (!managementPharmacist) continue;
        
        console.log(`[generateRota] PASS 7: Processing ${managementPharmacist.name} on management time`);
        
        // Skip non-default pharmacists - they should not displace others
        if (!managementPharmacist.isDefaultPharmacist) {
          console.log(`[generateRota] PASS 7: Skipping ${managementPharmacist.name} - non-default pharmacists should not displace others`);
          continue;
        }
        
        // Step 3: Find a ward in the management pharmacist's primary directorate
        const primaryDirectorate = managementPharmacist.primaryDirectorate;
        
        let targetWard = null;
        let existingAssignment = null;
        let displacedPharmacist = null;
        
        // Try to find their primary ward first
        if (Array.isArray(managementPharmacist.primaryWards) && managementPharmacist.primaryWards.length > 0) {
          for (const primaryWardName of managementPharmacist.primaryWards) {
            // Find the assignment for this ward
            const wardAssignment = assignments.find(a => 
              a.type === "ward" && a.location === primaryWardName
            );
            
            if (wardAssignment) {
              // This ward is already assigned to someone - we'll consider displacing them
              const potentialDisplaced = pharmacists.find(p => p && p._id === wardAssignment.pharmacistId);
              
              if (!potentialDisplaced) continue;
              
              // === ENHANCED DISPLACEMENT LOGIC ===
              // 1. Don't displace default pharmacists from their primary wards
              // 2. Don't displace pharmacists from their primary directorate if the displaced
              //    pharmacist couldn't be reassigned to their primary directorate
              
              // Check if this is a default pharmacist in their primary ward
              const isDefaultInPrimaryWard = 
                potentialDisplaced.isDefaultPharmacist && 
                potentialDisplaced.primaryWards?.includes(primaryWardName);
              
              if (isDefaultInPrimaryWard) {
                console.log(`[generateRota] PASS 7: Cannot displace ${potentialDisplaced.name} from ${primaryWardName} - they are a DEFAULT pharmacist in their primary ward`);
                continue;
              }
              
              // Check if potential displaced pharmacist would have a suitable place to go
              const displacedPrimaryDirectorate = potentialDisplaced.primaryDirectorate;
              const hasUncoveredWardInDisplacedDirectorate = uncoveredWards.some(w => {
                const ward = activeWards.find(aw => aw.name === w);
                return ward && ward.directorate === displacedPrimaryDirectorate;
              });
              
              // Only displace if:
              // 1. The displaced pharmacist has an uncovered ward in their primary directorate, OR
              // 2. The displaced pharmacist's primary directorate is the same as the ward they're currently in
              //    (meaning they'll stay in their primary directorate even after displacement)
              const wardDirectorate = activeWards.find(w => w.name === primaryWardName)?.directorate;
              
              if (!hasUncoveredWardInDisplacedDirectorate && 
                  displacedPrimaryDirectorate !== wardDirectorate) {
                console.log(`[generateRota] PASS 7: Not optimal to displace ${potentialDisplaced.name} from ${primaryWardName} - they would be moved out of their primary directorate with no suitable alternative`);
                continue;
              }
              
              // This is an acceptable displacement
              existingAssignment = wardAssignment;
              displacedPharmacist = potentialDisplaced;
              targetWard = activeWards.find(w => w.name === primaryWardName);
              
              console.log(`[generateRota] PASS 7: Found primary ward ${primaryWardName} of ${managementPharmacist.name}, currently assigned to ${displacedPharmacist?.name || 'unknown'}`);
              break;
            } else {
              // This ward isn't assigned - easy case, no displacement needed
              targetWard = activeWards.find(w => w.name === primaryWardName);
              if (targetWard) {
                console.log(`[generateRota] PASS 7: Assigning ${managementPharmacist.name} to unassigned primary ward ${primaryWardName}`);
                break;
              }
            }
          }
        }
        
        // If no primary ward found, find any ward in their primary directorate
        if (!targetWard && primaryDirectorate) {
          const directorateWards = activeWards.filter(w => w.directorate === primaryDirectorate);
          
          // First look for an unassigned ward in this directorate
          const unassignedDirectorateWard = directorateWards.find(w => !coveredWardNames.has(w.name));
          if (unassignedDirectorateWard) {
            targetWard = unassignedDirectorateWard;
            console.log(`[generateRota] PASS 7: Found unassigned ward ${targetWard.name} in ${managementPharmacist.name}'s primary directorate ${primaryDirectorate}`);
          } else {
            // Find a ward in the directorate that's already assigned to someone
            const wardAssignment = assignments.find(a => {
              if (a.type !== "ward") return false;
              const ward = activeWards.find(w => w.name === a.location);
              return ward && ward.directorate === primaryDirectorate;
            });
            
            if (wardAssignment) {
              const potentialDisplaced = pharmacists.find(p => p && p._id === wardAssignment.pharmacistId);
              
              // Don't displace default pharmacists from their primary ward/directorate
              if (potentialDisplaced && potentialDisplaced.isDefaultPharmacist) {
                const isPrimaryWard = potentialDisplaced.primaryWards && 
                                     potentialDisplaced.primaryWards.includes(wardAssignment.location);
                const isPrimaryDirectorate = potentialDisplaced.primaryDirectorate === primaryDirectorate;
                
                if (isPrimaryWard || isPrimaryDirectorate) {
                  console.log(`[generateRota] PASS 7: Cannot displace DEFAULT pharmacist ${potentialDisplaced.name} from ${wardAssignment.location} - it's their ${isPrimaryWard ? 'primary ward' : 'primary directorate'}`);
                  continue;
                }
              }
              
              existingAssignment = wardAssignment;
              displacedPharmacist = potentialDisplaced;
              targetWard = activeWards.find(w => w.name === wardAssignment.location);
              
              console.log(`[generateRota] PASS 7: Found ward ${targetWard?.name || wardAssignment.location} in ${managementPharmacist.name}'s primary directorate ${primaryDirectorate}, currently assigned to ${displacedPharmacist?.name || 'unknown'}`);
            }
          }
        }
        
        // If we found a target ward, make the reassignment
        if (targetWard) {
          // Remove the management assignment
          const mgmtIndex = assignments.findIndex(a => 
            a.type === "management" && a.pharmacistId === managementPharmacist._id
          );
          
          if (mgmtIndex !== -1) {
            assignments.splice(mgmtIndex, 1);
            
            // If there's an existing assignment for this ward, remove it
            if (existingAssignment) {
              const existingIndex = assignments.findIndex(a => 
                a.type === existingAssignment.type && 
                a.location === existingAssignment.location && 
                a.pharmacistId === existingAssignment.pharmacistId
              );
              
              if (existingIndex !== -1) {
                assignments.splice(existingIndex, 1);
              }
            }
            
            // Assign the management pharmacist to the target ward
            assignments.push({
              pharmacistId: managementPharmacist._id,
              type: "ward",
              location: targetWard.name,
              startTime: "00:00",
              endTime: "23:59"
            });
            
            console.log(`[generateRota] PASS 7: Assigned ${managementPharmacist.name} to ward ${targetWard.name} (${targetWard.directorate})`);
            
            // Remove this ward from uncovered if it was uncovered
            const uncoveredIndex = uncoveredWards.findIndex(w => w === targetWard.name);
            if (uncoveredIndex !== -1) {
              uncoveredWards.splice(uncoveredIndex, 1);
            }
            
            // Update covered wards set
            coveredWardNames.add(targetWard.name);
            
            // If there was a displaced pharmacist, try to assign them to an uncovered ward
            if (displacedPharmacist) {
              // Find a preferred uncovered ward for the displaced pharmacist
              // Prioritize primary ward matching first, then primary directorate, then trained directorates
              let bestMatchWard = null;
              
              // STEP 1: Check if any uncovered ward is a primary ward for this pharmacist
              if (displacedPharmacist.primaryWards) {
                const primaryWardMatch = uncoveredWards.find(wardName => 
                  displacedPharmacist.primaryWards?.includes(wardName)
                );
                
                if (primaryWardMatch) {
                  bestMatchWard = primaryWardMatch;
                  console.log(`[generateRota] PASS 7: Found primary ward match (${primaryWardMatch}) for displaced pharmacist ${displacedPharmacist.name}`);
                }
              }
              
              // STEP 2: If no primary ward match, check for primary directorate match
              if (!bestMatchWard && displacedPharmacist.primaryDirectorate) {
                const directorateMatch = uncoveredWards.find(wardName => {
                  const ward = activeWards.find(w => w.name === wardName);
                  return ward && ward.directorate === displacedPharmacist.primaryDirectorate;
                });
                
                if (directorateMatch) {
                  bestMatchWard = directorateMatch;
                  console.log(`[generateRota] PASS 7: Found primary directorate match (${directorateMatch}) for displaced pharmacist ${displacedPharmacist.name}`);
                }
              }
              
              // STEP 3: If no primary directorate match, check trained directorates
              if (!bestMatchWard && displacedPharmacist.trainedDirectorates) {
                for (const trainedDir of displacedPharmacist.trainedDirectorates) {
                  const trainedMatch = uncoveredWards.find(wardName => {
                    const ward = activeWards.find(w => w.name === wardName);
                    return ward && ward.directorate === trainedDir;
                  });
                  
                  if (trainedMatch) {
                    bestMatchWard = trainedMatch;
                    console.log(`[generateRota] PASS 7: Found trained directorate match (${trainedMatch}) for displaced pharmacist ${displacedPharmacist.name}`);
                    break;
                  }
                }
              }
              
              // STEP 4: If still no match, use any available ward
              if (!bestMatchWard && uncoveredWards.length > 0) {
                bestMatchWard = uncoveredWards[0];
                console.log(`[generateRota] PASS 7: No ideal match found, using first available ward (${bestMatchWard}) for displaced pharmacist ${displacedPharmacist.name}`);
              }
              
              if (bestMatchWard) {
                // Assign the displaced pharmacist to the best matching uncovered ward
                assignments.push({
                  pharmacistId: displacedPharmacist._id,
                  type: "ward",
                  location: bestMatchWard,
                  startTime: "00:00",
                  endTime: "23:59"
                });
                
                console.log(`[generateRota] PASS 7: Reassigned displaced pharmacist ${displacedPharmacist.name} to uncovered ward ${bestMatchWard} (${activeWards.find(w => w.name === bestMatchWard)?.directorate || 'unknown'})`);
                
                // Update the uncovered wards list
                const wardIndex = uncoveredWards.findIndex(w => w === bestMatchWard);
                if (wardIndex !== -1) {
                  uncoveredWards.splice(wardIndex, 1);
                }
                
                // Update the covered wards set
                coveredWardNames.add(bestMatchWard);
              } else {
                console.log(`[generateRota] PASS 7: No uncovered wards left for displaced pharmacist ${displacedPharmacist.name}`);
              }
            }
          } else {
            console.log(`[generateRota] PASS 7: Could not find a suitable ward in primary directorate for ${managementPharmacist.name}`);
          }
        } else {
          console.log(`[generateRota] PASS 7: Could not find a suitable ward in primary directorate for ${managementPharmacist.name}`);
        }
      }
    }
    
    console.log(`[generateRota] PASS 7: Completed. ${uncoveredWards.length} wards remain uncovered`);

    // --- PASS 8: BALANCE DIRECTORATE COVERAGE FOR MULTIPLE UNCOVERED WARDS ---
    console.log(`[generateRota] PASS 8: Starting - Balancing pharmacist allocation for directorates with multiple uncovered wards`);
    
    // Skip this pass if no uncovered wards
    if (uncoveredWards.length > 0) {
      // Keep track of how many pharmacists have been moved in this pass
      let pharmacistsMoved = 0;
      
      // Continue moving pharmacists until either no more deficient directorates or we've moved enough pharmacists
      const MAX_PHARMACISTS_TO_MOVE = 3; // Set a maximum to avoid emptying directorates
      
      while (pharmacistsMoved < MAX_PHARMACISTS_TO_MOVE) {
        // Group uncovered wards by directorate
        const uncoveredByDirectorate: Record<string, typeof activeWards[number][]> = {};
        
        for (const ward of uncoveredWards) {
          if (!ward) continue;
          
          const wardObject = activeWards.find(w => w.name === ward);
          if (!wardObject || !wardObject.directorate) continue;
          
          if (!uncoveredByDirectorate[wardObject.directorate]) {
            uncoveredByDirectorate[wardObject.directorate] = [];
          }
          uncoveredByDirectorate[wardObject.directorate].push(wardObject);
        }
        
        // Find directorates with multiple uncovered wards
        const deficientDirectorates = Object.entries(uncoveredByDirectorate)
          .filter(([_, wards]) => wards.length > 1)
          .sort(([_, wardsA], [__, wardsB]) => wardsB.length - wardsA.length); // Sort by most uncovered wards first
        
        // If no more deficient directorates, we're done
        if (deficientDirectorates.length === 0) {
          console.log(`[generateRota] PASS 8: No more directorates with multiple uncovered wards. Stopping after moving ${pharmacistsMoved} pharmacists.`);
          break;
        }
        
        console.log(`[generateRota] PASS 8: Found ${deficientDirectorates.length} directorates with multiple uncovered wards:`, 
          deficientDirectorates.map(([dir, wards]) => `${dir} (${wards.length} wards)`));
        
        // Find directorates with full allocation (all wards covered)
        const fullyAllocatedDirectorates = new Set<string>();
        
        // Get all active directorates
        const allDirectorates = new Set(activeWards.map(w => w.directorate).filter(Boolean) as string[]);
        
        // Check each directorate to see if all its wards are covered
        for (const directorate of allDirectorates) {
          const dirWards = activeWards.filter(w => w.directorate === directorate);
          const coveredDirWards = dirWards.filter(w => coveredWardNames.has(w.name));
          
          // Only consider directorates with more than one pharmacist to avoid emptying them
          const pharmacistsInDirectorate = new Set(
            assignments
              .filter(a => a.type === "ward")
              .filter(a => {
                const ward = activeWards.find(w => w.name === a.location);
                return ward && ward.directorate === directorate;
              })
              .map(a => a.pharmacistId)
          );
          
          if (dirWards.length === coveredDirWards.length && dirWards.length > 1 && pharmacistsInDirectorate.size > 1) {
            fullyAllocatedDirectorates.add(directorate);
          }
        }
        
        console.log(`[generateRota] PASS 8: Found ${fullyAllocatedDirectorates.size} fully allocated directorates with multiple pharmacists:`, 
          Array.from(fullyAllocatedDirectorates));
          
        // If no fully allocated directorates with enough pharmacists, we can't proceed
        if (fullyAllocatedDirectorates.size === 0) {
          console.log(`[generateRota] PASS 8: No directorates with sufficient pharmacists to reallocate. Stopping.`);
          break;
        }
        
        // Pick the most deficient directorate
        const [deficientDir, deficientWards] = deficientDirectorates[0];
        console.log(`[generateRota] PASS 8: Processing directorate ${deficientDir} with ${deficientWards.length} uncovered wards`);
        
        // Find eligible pharmacists from fully allocated directorates
        const eligiblePharmacists: Array<{
          pharmacist: typeof pharmacists[number];
          currentWard: typeof activeWards[number];
          assignment: Assignment;
        }> = [];
        
        // Get all ward assignments
        const wardAssignments = assignments.filter(a => a.type === "ward");
        
        // Group assignments by pharmacist to check for cross-directorate assignments
        const pharmacistAssignments: Record<string, Array<{assignment: Assignment; ward: typeof activeWards[number]}>> = {};
        
        for (const assignment of wardAssignments) {
          const ward = activeWards.find(w => w.name === assignment.location);
          if (!ward || !ward.directorate) continue;
          
          if (!pharmacistAssignments[assignment.pharmacistId]) {
            pharmacistAssignments[assignment.pharmacistId] = [];
          }
          
          pharmacistAssignments[assignment.pharmacistId].push({
            assignment,
            ward
          });
        }
        
        for (const assignment of wardAssignments) {
          const ward = activeWards.find(w => w.name === assignment.location);
          if (!ward || !ward.directorate) continue;
          
          // Skip if not in a fully allocated directorate
          if (!fullyAllocatedDirectorates.has(ward.directorate)) continue;
          
          // Skip EAU and ITU wards as per requirements
          if (ward.name.includes("EAU") || ward.name.includes("ITU")) {
            console.log(`[generateRota] PASS 8: Skipping ${ward.name} as it's protected (EAU/ITU)`);
            continue;
          }
          
          // Check if removing this pharmacist would leave the directorate without coverage
          const pharmacistsInSameDirectorate = assignments.filter(a => {
            if (a.type !== "ward" || a.pharmacistId === assignment.pharmacistId) return false;
            const w = activeWards.find(ward => ward.name === a.location);
            return w && w.directorate === ward.directorate;
          });
          
          if (pharmacistsInSameDirectorate.length === 0) {
            console.log(`[generateRota] PASS 8: Skipping pharmacist on ${ward.name} as they are the only one in directorate ${ward.directorate}`);
            continue;
          }
          
          // Check if pharmacist has already been assigned to a different directorate
          const pharmacistAllAssignments = pharmacistAssignments[assignment.pharmacistId] || [];
          const hasOtherDirectorates = pharmacistAllAssignments.some(item => 
            item.ward.directorate && item.ward.directorate !== ward.directorate
          );
          
          if (hasOtherDirectorates) {
            console.log(`[generateRota] PASS 8: Skipping pharmacist on ${ward.name} as they are already assigned to a different directorate`);
            continue;
          }
          
          const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
          
          if (pharmacist) {
            // Add to eligible list
            eligiblePharmacists.push({
              pharmacist,
              currentWard: ward,
              assignment
            });
          }
        }
        
        // Sort eligible pharmacists by:
        // 1. Non-default pharmacists first
        // 2. Lower band pharmacists first (band 6, then 7)
        // 3. Not trained in their current directorate
        eligiblePharmacists.sort((a, b) => {
          // Check if they're default pharmacists
          const aIsDefault = a.pharmacist && a.pharmacist.primaryWards && a.pharmacist.primaryWards.includes(a.currentWard.name);
          const bIsDefault = b.pharmacist && b.pharmacist.primaryWards && b.pharmacist.primaryWards.includes(b.currentWard.name);
          
          if (!aIsDefault && bIsDefault) return -1; // Prefer non-default
          if (aIsDefault && !bIsDefault) return 1;
          
          // Check band - prefer LOWER bands (6, then 7) to move
          if (a.pharmacist && b.pharmacist) {
            if (a.pharmacist.band < b.pharmacist.band) return -1; // Lower band comes first
            if (a.pharmacist.band > b.pharmacist.band) return 1;
          }
          
          // Check if trained in their current directorate
          const aIsTrained = a.pharmacist && a.pharmacist.trainedDirectorates && a.currentWard.directorate && a.pharmacist.trainedDirectorates.includes(a.currentWard.directorate);
          const bIsTrained = b.pharmacist && b.pharmacist.trainedDirectorates && b.currentWard.directorate && b.pharmacist.trainedDirectorates.includes(b.currentWard.directorate);
          
          if (!aIsTrained && bIsTrained) return -1; // Prefer moving those not trained in their current directorate
          if (aIsTrained && !bIsTrained) return 1;
          
          return 0;
        });
        
        console.log(`[generateRota] PASS 8: Found ${eligiblePharmacists.length} eligible pharmacists to potentially move`);
        
        // If no eligible pharmacists, we're done
        if (eligiblePharmacists.length === 0) {
          console.log(`[generateRota] PASS 8: No eligible pharmacists to move. Stopping.`);
          break;
        }
        
        // Pick the first uncovered ward from the deficient directorate
        const targetWard = deficientWards[0];
        if (!targetWard) {
          console.log(`[generateRota] PASS 8: No uncovered wards in deficient directorate. Stopping.`);
          break;
        }
        
        // Get the best match (lowest band, non-default pharmacist)
        const bestMatch = eligiblePharmacists[0];
        if (!bestMatch || !bestMatch.pharmacist) {
          console.log(`[generateRota] PASS 8: No valid pharmacist match found. Stopping.`);
          break;
        }
        
        // Using a non-null assertion after checking to help TypeScript understand
        const pharmacist = bestMatch.pharmacist!;
        
        console.log(`[generateRota] PASS 8: Selected ${pharmacist.name} (band ${pharmacist.band}) from ${bestMatch.currentWard.name} to reassign to ${targetWard.name}`);
        
        // Remove the existing assignment
        const existingIndex = assignments.findIndex(a => 
          a.type === bestMatch.assignment.type && 
          a.location === bestMatch.assignment.location && 
          a.pharmacistId === bestMatch.assignment.pharmacistId
        );
        
        if (existingIndex !== -1) {
          assignments.splice(existingIndex, 1);
          
          // Mark the source ward as uncovered since we removed its pharmacist
          coveredWardNames.delete(bestMatch.assignment.location);
          
          // Add the source ward to the uncovered wards list
          if (!uncoveredWards.includes(bestMatch.assignment.location)) {
            uncoveredWards.push(bestMatch.assignment.location);
            console.log(`[generateRota] PASS 8: Added ${bestMatch.assignment.location} to uncovered wards after moving ${pharmacist.name}`);
          }
        }
        
        // Make the new assignment
        assignments.push({
          pharmacistId: pharmacist._id,
          type: "ward",
          location: targetWard.name,
          startTime: "00:00",
          endTime: "23:59"
        });
        
        console.log(`[generateRota] PASS 8: Moved ${pharmacist.name} from ${bestMatch.currentWard.name} to ${targetWard.name} in deficient directorate ${deficientDir}`);
        
        // Remove this ward from uncovered if it was uncovered
        const uncoveredIndex = uncoveredWards.findIndex(w => w === targetWard.name);
        if (uncoveredIndex !== -1) {
          uncoveredWards.splice(uncoveredIndex, 1);
        }
        
        // Update covered wards set
        coveredWardNames.add(targetWard.name);
        
        // Increment counter
        pharmacistsMoved++;
        
        // Check if the source directorate still has at least one pharmacist
        const sourceDirectorate = bestMatch.currentWard.directorate;
        if (sourceDirectorate) {
          const pharmacistsInSourceDirectorate = assignments.filter(a => {
            if (a.type !== "ward") return false;
            const ward = activeWards.find(w => w.name === a.location);
            return ward && ward.directorate === sourceDirectorate;
          });
          
          console.log(`[generateRota] PASS 8: After move, source directorate ${sourceDirectorate} has ${pharmacistsInSourceDirectorate.length} pharmacists remaining`);
          
          if (pharmacistsInSourceDirectorate.length === 0) {
            console.log(`[generateRota] PASS 8: WARNING: Source directorate ${sourceDirectorate} now has no pharmacists`);
          }
        }
        
        // Re-evaluate after each move
        console.log(`[generateRota] PASS 8: Re-evaluating after moving ${pharmacistsMoved} pharmacist(s)`);
      }
      
      console.log(`[generateRota] PASS 8: Completed. Moved ${pharmacistsMoved} pharmacists. ${uncoveredWards.length} wards remain uncovered`);
    } else {
      console.log(`[generateRota] PASS 8: Skipped - no uncovered wards`);
    }
    
    // --- PASS 9: PAIRING UNCOVERED WARDS WITHIN DIRECTORATES ---
    console.log(`[generateRota] PASS 9: Starting - Pairing uncovered wards within directorates`);
    
    if (uncoveredWards.length > 0) {
      // Group uncovered wards by directorate
      const uncoveredByDirectorate: Record<string, typeof activeWards[number][]> = {};
      
      for (const ward of uncoveredWards) {
        if (!ward) continue;
        
        const wardObject = activeWards.find(w => w.name === ward);
        if (!wardObject || !wardObject.directorate) continue;
        
        if (!uncoveredByDirectorate[wardObject.directorate]) {
          uncoveredByDirectorate[wardObject.directorate] = [];
        }
        uncoveredByDirectorate[wardObject.directorate].push(wardObject);
      }
      
      // Sort directorates by number of uncovered wards
      const directoratesWithUncovered = Object.entries(uncoveredByDirectorate)
        .sort(([_, wardsA], [__, wardsB]) => wardsB.length - wardsA.length); // Sort by most uncovered wards first
      
      console.log(`[generateRota] PASS 9: Found ${directoratesWithUncovered.length} directorates with uncovered wards:`, 
        directoratesWithUncovered.map(([dir, wards]) => `${dir} (${wards.length} wards)`));
      
      // Process each directorate with uncovered wards
      for (const [directorate, dirUncoveredWards] of directoratesWithUncovered) {
        console.log(`[generateRota] PASS 9: Processing directorate ${directorate} with ${dirUncoveredWards.length} uncovered wards`);
        
        // Sort wards within directorate by score/weight (if available) or alphabetically
        const sortedWards = [...dirUncoveredWards].sort((a, b) => {
          // If we have difficulty information, use it (lower difficulty = lower priority)
          if (a.difficulty !== undefined && b.difficulty !== undefined) {
            return a.difficulty - b.difficulty;
          }
          // Otherwise sort alphabetically
          return a.name.localeCompare(b.name);
        });
        
        // Find pharmacists already assigned to the directorate who could cover additional wards
        const assignmentsInDirectorate = assignments.filter(a => {
          if (a.type !== "ward") return false;
          const ward = activeWards.find(w => w.name === a.location);
          return ward && ward.directorate === directorate;
        });
        
        // Group these by pharmacist
        type PharmacistWithWards = {
          pharmacist: NonNullable<typeof pharmacists[0]>;
          assignedWards: typeof activeWards[number][];
        };
        
        // First, check all pharmacist assignments to make sure we don't split between directorates
        const allPharmacistWards: Record<string, {ward: typeof activeWards[number], directorate: string}[]> = {};
        
        // Get all assignments for all pharmacists across all directorates
        for (const assignment of assignments.filter(a => a.type === "ward")) {
          const pharmacistId = assignment.pharmacistId;
          const ward = activeWards.find(w => w.name === assignment.location);
          
          if (!ward || !ward.directorate) continue;
          
          if (!allPharmacistWards[pharmacistId]) {
            allPharmacistWards[pharmacistId] = [];
          }
          
          allPharmacistWards[pharmacistId].push({
            ward,
            directorate: ward.directorate
          });
        }
        
        const pharmacistsInDirectorate: Record<string, PharmacistWithWards> = {};
        
        for (const assignment of assignmentsInDirectorate) {
          const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
          const ward = activeWards.find(w => w.name === assignment.location);
          
          if (!pharmacist || !ward) continue;
          
          // Skip if pharmacist is already assigned to a different directorate
          const pharmacistAssignments = allPharmacistWards[pharmacist._id] || [];
          const hasOtherDirectorates = pharmacistAssignments.some(item => 
            item.directorate !== directorate
          );
          
          if (hasOtherDirectorates) {
            console.log(`[generateRota] PASS 9: Skipping ${pharmacist.name} as they are already assigned to a different directorate`);
            continue;
          }
          
          if (!pharmacistsInDirectorate[pharmacist._id]) {
            pharmacistsInDirectorate[pharmacist._id] = {
              pharmacist, 
              assignedWards: []
            };
          }
          
          pharmacistsInDirectorate[pharmacist._id].assignedWards.push(ward);
        }
        
        // Prioritize pharmacists who already have primary wards in this directorate
        const candidatePharmacists = Object.values(pharmacistsInDirectorate)
          .sort((a: PharmacistWithWards, b: PharmacistWithWards) => {
            // First prioritize pharmacists with multiple primary wards in the directorate
            const aPrimaryWardCount = a.pharmacist.primaryWards?.filter((wardName: string) => {
              const ward = activeWards.find(w => w.name === wardName);
              return ward && ward.directorate === directorate;
            }).length || 0;
            
            const bPrimaryWardCount = b.pharmacist.primaryWards?.filter((wardName: string) => {
              const ward = activeWards.find(w => w.name === wardName);
              return ward && ward.directorate === directorate;
            }).length || 0;
            
            if (aPrimaryWardCount > 1 && bPrimaryWardCount <= 1) return -1;
            if (aPrimaryWardCount <= 1 && bPrimaryWardCount > 1) return 1;
            
            // Then prioritize by band (lowest first)
            const aBand = a.pharmacist.band || '';
            const bBand = b.pharmacist.band || '';
            
            if (aBand < bBand) return -1;
            if (aBand > bBand) return 1;
            
            // Then prioritize those trained in the directorate
            const aIsTrained = (a.pharmacist.trainedDirectorates || []).includes(directorate);
            const bIsTrained = (b.pharmacist.trainedDirectorates || []).includes(directorate);
            
            if (aIsTrained && !bIsTrained) return -1;
            if (!aIsTrained && bIsTrained) return 1;
            
            return 0;
          });
        
        console.log(`[generateRota] PASS 9: Found ${candidatePharmacists.length} potential pharmacists to cover multiple wards in ${directorate}`);
        
        // Pair the lowest priority uncovered wards with pharmacists
        while (sortedWards.length > 0 && candidatePharmacists.length > 0) {
          const ward = sortedWards.shift();
          if (!ward) break;
          
          const bestMatch = candidatePharmacists[0]; // Take the best match based on the sorting above
          
          console.log(`[generateRota] PASS 9: Assigning ${bestMatch.pharmacist.name} to cover additional ward ${ward.name} in directorate ${directorate}`);
          
          // Assign the ward to this pharmacist
          assignments.push({
            pharmacistId: bestMatch.pharmacist._id,
            type: "ward",
            location: ward.name,
            startTime: "00:00",
            endTime: "23:59"
          });
          
          // Mark the ward as covered
          const uncoveredIndex = uncoveredWards.findIndex(w => w === ward.name);
          if (uncoveredIndex !== -1) {
            uncoveredWards.splice(uncoveredIndex, 1);
          }
          
          // Update the pharmacist's assigned wards
          bestMatch.assignedWards.push(ward);
          
          // Re-sort the candidate pharmacists to account for new assignment
          // This will put pharmacists with the fewest assigned wards at the top
          candidatePharmacists.sort((a: PharmacistWithWards, b: PharmacistWithWards) => 
            a.assignedWards.length - b.assignedWards.length
          );
          
          console.log(`[generateRota] PASS 9: ${bestMatch.pharmacist.name} now covers ${bestMatch.assignedWards.length} wards in ${directorate}: ${bestMatch.assignedWards.map((w: typeof activeWards[number]) => w.name).join(', ')}`);
        }
      }
    }
    
    console.log(`[generateRota] PASS 9: Completed. ${uncoveredWards.length} wards remain uncovered`);

    // --- PASS 9.5: OPTIMIZE STAFFING - MOVE PHARMACISTS FROM OVERSTAFFED WARDS TO FREE UP BAND 8A FOR MANAGEMENT ---
    console.log('[generateRota] PASS 9.5: Starting - Optimizing staffing to free up default Band 8a pharmacists for management');
    
    // First, identify wards with more pharmacists than needed
    const overstaffedWards: Array<{ward: typeof activeWards[number], assignments: Assignment[], excess: number}> = [];
    const wardAssignmentCounts: Record<string, Assignment[]> = {};
    
    // Count how many pharmacists are assigned to each ward
    for (const assignment of assignments.filter(a => a.type === "ward")) {
      if (!wardAssignmentCounts[assignment.location]) {
        wardAssignmentCounts[assignment.location] = [];
      }
      wardAssignmentCounts[assignment.location].push(assignment);
    }
    
    // Check if any wards are overstaffed
    for (const wardName in wardAssignmentCounts) {
      const ward = activeWards.find(w => w.name === wardName);
      if (!ward) continue;
      
      const idealCount = ward.idealPharmacists;
      const actualCount = wardAssignmentCounts[wardName].length;
      
      if (actualCount > idealCount) {
        // This ward has more pharmacists than needed
        overstaffedWards.push({
          ward,
          assignments: wardAssignmentCounts[wardName],
          excess: actualCount - idealCount
        });
      }
    }
    
    // Log overstaffed wards
    console.log(`[generateRota] PASS 9.5: Found ${overstaffedWards.length} overstaffed wards:`, 
      overstaffedWards.map(w => `${w.ward.name} (excess: ${w.excess})`));
    
    // Next, identify wards with default Band 8a pharmacists who could be moved to management
    const wardsWithDefaultBand8a = [];
    
    for (const assignment of assignments.filter(a => a.type === "ward")) {
      const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
      if (!pharmacist) continue;
      
      // Check if this is a default Band 8a pharmacist
      if (pharmacist.band === "8a" && pharmacist.isDefaultPharmacist) {
        wardsWithDefaultBand8a.push({
          ward: activeWards.find(w => w.name === assignment.location),
          pharmacist,
          assignment
        });
      }
    }
    
    console.log(`[generateRota] PASS 9.5: Found ${wardsWithDefaultBand8a.length} wards with default Band 8a pharmacists`);   
    
    // For each overstaffed ward, try to use excess pharmacists to replace default Band 8a
    let reassignmentsMade = 0;
    
    for (const overstaffedData of overstaffedWards) {
      // Skip if no excess pharmacists available anymore
      if (overstaffedData.excess <= 0) continue;
      
      // Skip special wards (EAU, ITU) as they require specific coverage
      if (overstaffedData.ward.name.includes('Emergency') || 
          overstaffedData.ward.name.includes('ITU')) {
        console.log(`[generateRota] PASS 9.5: Skipping special ward ${overstaffedData.ward.name}`);
        continue;
      }
      
      // Sort pharmacists by priority for keeping vs. moving
      // We prefer to keep primary ward pharmacists and move others
      const assignmentsToConsiderMoving = [...overstaffedData.assignments].sort((a, b) => {
        const pharmacistA = pharmacists.find(p => p && p._id === a.pharmacistId);
        const pharmacistB = pharmacists.find(p => p && p._id === b.pharmacistId);
        
        if (!pharmacistA || !pharmacistB) return 0;
        
        // Check if either is primary ward pharmacist
        const aIsPrimary = pharmacistA.primaryWards?.includes(overstaffedData.ward.name) || false;
        const bIsPrimary = pharmacistB.primaryWards?.includes(overstaffedData.ward.name) || false;
        
        if (aIsPrimary && !bIsPrimary) return 1; // Keep A (primary)
        if (!aIsPrimary && bIsPrimary) return -1; // Move A (non-primary)
        
        // If neither is primary or both are primary, consider band
        // Prefer to move lower bands first
        const bandA = pharmacistA.band || '6';
        const bandB = pharmacistB.band || '6';
        
        if (bandA < bandB) return -1; // Move lower band first
        if (bandA > bandB) return 1;
        
        return 0;
      });
      
      // Process each Band 8a that could be freed up for management
      for (const band8aData of wardsWithDefaultBand8a) {
        // Skip if no excess pharmacists available anymore
        if (overstaffedData.excess <= 0) break;
        
        // Skip if this is the same ward
        if (band8aData.ward?.name === overstaffedData.ward.name) continue;
        
        // Identify appropriate pharmacists who have training for the target ward
        const targetWard = band8aData.ward;
        if (!targetWard) continue;
        
        // Find pharmacists who can be moved based on their training and experience
        const qualifiedPharmacistsIndices: number[] = [];
        
        for (let i = 0; i < assignmentsToConsiderMoving.length; i++) {
          const assignment = assignmentsToConsiderMoving[i];
          const pharmacist = pharmacists.find(p => p && p._id === assignment.pharmacistId);
          if (!pharmacist) continue;
          
          // Check if pharmacist has training in the target directorate
          const hasDirectorateTraining = pharmacist.trainedDirectorates?.includes(targetWard.directorate) || false;
          
          // Check if the ward requires special training and if the pharmacist has it
          let hasRequiredSpecialTraining = true;
          if (targetWard.requiresSpecialTraining && targetWard.trainingType) {
            hasRequiredSpecialTraining = pharmacist.specialistTraining?.includes(targetWard.trainingType) || false;
          }
          
          // Check if this is a primary ward for the pharmacist
          const isPrimaryWard = pharmacist.primaryWards?.includes(targetWard.name) || false;
          
          // Special handling for ITU - require explicit ITU training
          const isITUWard = targetWard.name.includes('ITU');
          const hasITUTraining = pharmacist.specialistTraining?.includes('ITU') || false;
          
          if ((hasDirectorateTraining || isPrimaryWard) && 
              hasRequiredSpecialTraining && 
              (!isITUWard || hasITUTraining)) {
            qualifiedPharmacistsIndices.push(i);
          }
        }
        
        // If no qualified pharmacists found, skip this Band 8a
        if (qualifiedPharmacistsIndices.length === 0) {
          console.log(`[generateRota] PASS 9.5: No qualified pharmacists found to replace Band 8a in ${targetWard.name}`);
          continue;
        }
        
        // Get the first qualified pharmacist
        const qualifiedIdx = qualifiedPharmacistsIndices[0];
        const pharmacistToMove = assignmentsToConsiderMoving[qualifiedIdx];
        
        // Remove from the list of assignments to consider
        assignmentsToConsiderMoving.splice(qualifiedIdx, 1);
        
        // Get the pharmacist object
        const movingPharmacist = pharmacists.find(p => p && p._id === pharmacistToMove.pharmacistId);
        if (!movingPharmacist) continue;
        
        console.log(`[generateRota] PASS 9.5: Moving ${movingPharmacist.name} from overstaffed ward ${overstaffedData.ward.name} to replace Band 8a ${band8aData.pharmacist.name} in ${band8aData.ward?.name}`);
        
        // Remove this pharmacist from the overstaffed ward
        const removeIndex = assignments.findIndex(a => 
          a.pharmacistId === pharmacistToMove.pharmacistId && 
          a.location === overstaffedData.ward.name &&
          a.type === 'ward'
        );
        
        if (removeIndex !== -1) {
          assignments.splice(removeIndex, 1);
        }
        
        // Remove the Band 8a from their ward
        const removeBand8aIndex = assignments.findIndex(a => 
          a.pharmacistId === band8aData.pharmacist._id && 
          a.location === band8aData.ward?.name &&
          a.type === 'ward'
        );
        
        if (removeBand8aIndex !== -1) {
          assignments.splice(removeBand8aIndex, 1);
        }
        
        // Add the pharmacist to the Band 8a's previous ward
        assignments.push({
          pharmacistId: movingPharmacist._id,
          type: "ward",
          location: band8aData.ward?.name || '',
          startTime: "00:00",
          endTime: "23:59"
        });
        
        // Put the Band 8a in management
        assignments.push({
          pharmacistId: band8aData.pharmacist._id,
          type: "management",
          location: "Management Time",
          startTime: "00:00",
          endTime: "23:59"
        });
        
        // Update counters
        overstaffedData.excess--;
        reassignmentsMade++;
        
        // Remove this Band 8a from the list since they're now handled
        wardsWithDefaultBand8a.splice(wardsWithDefaultBand8a.indexOf(band8aData), 1);
      }
    }
    
    console.log(`[generateRota] PASS 9.5: Completed. Made ${reassignmentsMade} reassignments to optimize staffing.`);

    // Helper function to check for conflicting clinic assignment
    function hasClinicConflict(pharmacistId: string, startTime: string, endTime: string, assignments: Assignment[]): boolean {
      return assignments.some(a =>
        a.pharmacistId === pharmacistId &&
        a.type === "clinic" &&
        // Check for time overlap
        ((a.startTime < endTime) && (a.endTime > startTime))
      );
    }

    // Helper function to check if pharmacist is not available for a given day/time
    function isPharmacistNotAvailable(
      pharmacist: Doc<"pharmacists"> | null,
      dayLabel: string,
      slotStart: string,
      slotEnd: string
    ): boolean {
      if (!pharmacist) return false;
      
      // Check if we have effective unavailable rules for this pharmacist
      if (args.effectiveUnavailableRules && args.effectiveUnavailableRules[pharmacist._id as string]) {
        // Use the effective rules provided from the frontend
        const rules = args.effectiveUnavailableRules[pharmacist._id as string];
        return rules.some((rule: {dayOfWeek: string; startTime: string; endTime: string}) => {
          if (rule.dayOfWeek !== dayLabel) return false;
          // If slot overlaps with not available rule
          return !(slotEnd <= rule.startTime || slotStart >= rule.endTime);
        });
      } else if (pharmacist.notAvailableRules) {
        // Fall back to the pharmacist's permanent unavailable rules
        return pharmacist.notAvailableRules.some((rule: {dayOfWeek: string; startTime: string; endTime: string;}) => {
          if (rule.dayOfWeek !== dayLabel) return false;
          // If slot overlaps with not available rule
          return !(slotEnd <= rule.startTime || slotStart >= rule.endTime);
        });
      }
      
      // No unavailable rules found
      return false;
    }

    // Helper function to get working pharmacists for a specific day
    function getWorkingPharmacistsForDay(
      allPharmacists: (Doc<"pharmacists"> | null)[],
      args: { pharmacistIds: Id<"pharmacists">[]; pharmacistWorkingDays?: Record<string, string[]> },
      dayOfWeek: number
    ): (Doc<"pharmacists"> | null)[] {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayName = dayNames[dayOfWeek];
      
      console.log('[getWorkingPharmacistsForDay] Checking for day:', dayName, 'dayOfWeek:', dayOfWeek);
      
      // Non-null pharmacists who are in the pharmacistIds list for this rota
      const nonNullPharmacists = allPharmacists.filter(p => 
        p !== null && args.pharmacistIds.includes(p._id)
      );
      
      // If pharmacistWorkingDays is provided, further filter those who work today
      if (args.pharmacistWorkingDays) {
        console.log('[getWorkingPharmacistsForDay] Checking working days:', args.pharmacistWorkingDays);
        
        return nonNullPharmacists.filter(p => {
          if (!p) return false;
          
          const daysForPharmacist = args.pharmacistWorkingDays?.[p._id as string];
          const worksToday = daysForPharmacist && daysForPharmacist.includes(dayName);
          
          console.log(`[getWorkingPharmacistsForDay] Pharmacist ${p.name} works ${dayName}? ${worksToday ? 'YES' : 'NO'} (Days: ${daysForPharmacist?.join(', ') || 'none'})`);
          
          return worksToday;
        });
      }
      
      // If no working days specified, assume all work
      return nonNullPharmacists;
    }

    // Helper function to get warfarin clinic pharmacists for today
    function getWarfarinClinicPharmacists(assignments: Assignment[], clinics: any[]): Set<string> {
      // Find all assignments for today that are clinics and require warfarin training
      const warfarinClinicPharmacistIds = new Set<string>();
      assignments.forEach(a => {
        if (a.type === "clinic") {
          // Find the clinic object for this assignment
          const clinic = clinics.find(c => c.name === a.location);
          if (clinic && clinic.requiresWarfarinTraining) {
            warfarinClinicPharmacistIds.add(a.pharmacistId as string);
          }
        }
      });
      return warfarinClinicPharmacistIds;
    }

    // Helper function to identify pharmacists covering multiple wards
    function getMultiWardPharmacists(assignments: Assignment[]): Set<string> {
      // Group assignments by pharmacist
      const pharmacistWardCounts: Record<string, string[]> = {};
      
      // Count wards per pharmacist
      assignments.forEach(a => {
        if (a.type === "ward") {
          if (!pharmacistWardCounts[a.pharmacistId]) {
            pharmacistWardCounts[a.pharmacistId] = [];
          }
          if (!pharmacistWardCounts[a.pharmacistId].includes(a.location)) {
            pharmacistWardCounts[a.pharmacistId].push(a.location);
          }
        }
      });
      
      // Return the set of pharmacist IDs who cover multiple wards
      const multiWardPharmacistIds = new Set<string>();
      Object.entries(pharmacistWardCounts).forEach(([pharmacistId, wards]) => {
        if (wards.length > 1) {
          multiWardPharmacistIds.add(pharmacistId);
        }
      });
      
      return multiWardPharmacistIds;
    }

    // Helper function to check if a pharmacist is the only one covering any directorate
    function isSolePharmacistInAnyDirectorate(pharmacistId: string): boolean {
      // Group ward assignments by directorate
      const pharmacistsByDirectorate: Record<string, Set<string>> = {};
      
      // Build a map of directorates to the pharmacists assigned to them
      assignments.forEach(a => {
        if (a.type === "ward") {
          const ward = activeWards.find(w => w.name === a.location);
          if (ward && ward.directorate) {
            if (!pharmacistsByDirectorate[ward.directorate]) {
              pharmacistsByDirectorate[ward.directorate] = new Set<string>();
            }
            pharmacistsByDirectorate[ward.directorate].add(a.pharmacistId);
          }
        }
      });
      
      // Check if this pharmacist is the only one in any directorate
      for (const [directorate, pharmacists] of Object.entries(pharmacistsByDirectorate)) {
        if (pharmacists.size === 1 && pharmacists.has(pharmacistId)) {
          console.log(`[generateRota] Pharmacist ${pharmacistId} is the only one covering directorate ${directorate} - exempting from dispensary duty`);
          return true;
        }
      }
      
      return false;
    }

    // --- Ensure only one rota per date ---
    // Delete any existing rota for this date before inserting
    const existingRotas = await ctx.db.query("rotas").filter(q => q.eq(q.field("date"), args.date)).collect();
    for (const r of existingRotas) {
      await ctx.db.delete(r._id);
    }
    // --- END Ensure only one rota per date ---
    return await ctx.db.insert("rotas", {
      date: args.date,
      assignments: assignments as { type: "ward" | "dispensary" | "clinic" | "management"; startTime: string; endTime: string; pharmacistId: Id<"pharmacists">; location: string; isLunchCover?: boolean }[],
      status: "draft",
      generatedBy: "system",
      generatedAt: Date.now(),
      includedWeekdays: args.includedWeekdays, // Store which weekdays were included in rota generation
      conflicts,
    });
  },
});

export const generateWeeklyRota = mutation({
  args: {
    startDate: v.string(), // Monday date (YYYY-MM-DD)
    pharmacistIds: v.array(v.id("pharmacists")),
    clinicIds: v.optional(v.array(v.id("clinics"))),
    pharmacistWorkingDays: v.optional(v.record(v.string(), v.array(v.string()))),
    singlePharmacistDispensaryDays: v.optional(v.array(v.string())),
    regenerateRota: v.optional(v.boolean()),
    effectiveUnavailableRules: v.optional(v.record(v.string(), v.array(v.object({
      dayOfWeek: v.string(),
      startTime: v.string(),
      endTime: v.string()
    })))),
    // New parameter to specify which weekdays to include in rota generation
    selectedWeekdays: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args): Promise<Id<"rotas">[]> => {
    console.log('TEST LOG: generateWeeklyRota called with args:', JSON.stringify(args));
    const start = new Date(args.startDate);
    console.log('[generateWeeklyRota] startDate:', args.startDate, 'parsed:', start.toISOString(), 'weekday:', start.getDay());
    if (isNaN(start.getTime())) throw new Error("Invalid start date");
    if (start.getDay() !== 1) throw new Error("Start date must be a Monday");
    const rotas: Id<"rotas">[] = [];
    // --- Combined duty tracking (both dispensary shifts and lunch cover) ---
    const dispensaryDutyCounts: Record<string, number> = {};
    args.pharmacistIds.forEach(pid => dispensaryDutyCounts[pid] = 0);
    
    // Pre-fetch all pharmacists to identify dispensary pharmacist for accuracy
    const allPharmacists = await Promise.all(
      args.pharmacistIds.map(id => ctx.db.get(id))
    );
    
    // Identify the dispensary pharmacist (band="Dispensary Pharmacist")
    const dispensaryPharmacist = allPharmacists.find(p => p && p.band === "Dispensary Pharmacist");
    
    if (dispensaryPharmacist) {
      console.log(`[generateWeeklyRota] Identified dispensary pharmacist: ${dispensaryPharmacist.name}`);
      
      // The dispensary pharmacist should be weighted to handle more dispensary shifts
      // They're the primary person, but will need coverage on days off and for lunch
      dispensaryDutyCounts[dispensaryPharmacist._id] = -10; // Negative value prioritizes them for assignments
    }
    
    // Weight: Exclude practitioner pharmacists from duty count tracking
    const practitionerPharmacists = allPharmacists.filter(p => p && p.band === "EAU Practitioner");
    practitionerPharmacists.forEach(p => {
      if (p) {
        dispensaryDutyCounts[p._id] = 1000; // Large positive value prevents assignment
        console.log(`[generateWeeklyRota] Excluded EAU Practitioner pharmacist: ${p.name}`);
      }
    });
    
    // --------- TRACK WEEKLY PHARMACIST DUTY COUNTS ---------
    // Track which pharmacists have done any dispensary duty this week
    // So we can prioritize fresh pharmacists for lunch cover each day
    const weeklyPharmacistDuties: Record<string, boolean> = {};
    
    // NEW: Track clinic assignments for the week to avoid assigning the same pharmacist to multiple clinics
    const weeklyClinicAssignments: Record<string, number> = {};
    args.pharmacistIds.forEach(pid => weeklyClinicAssignments[pid] = 0);
    
    // Create a log of daily assignments for easy tracking
    const dailyAssignments: Record<string, string[]> = {};
    
    for (let i = 0; i < 5; i++) { // Monday to Friday
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const isoDate = date.toISOString().split("T")[0];
      let workingPharmacists = args.pharmacistIds;
      let dayLabel = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][i];
      
      // Skip this day if it's not in the selectedWeekdays array
      if (args.selectedWeekdays && !args.selectedWeekdays.includes(dayLabel)) {
        console.log(`[generateWeeklyRota] Skipping ${dayLabel} (${isoDate}) as it's not in selectedWeekdays:`, args.selectedWeekdays);
        continue; // Skip to the next day
      }
      
      if (args.pharmacistWorkingDays) {
        workingPharmacists = args.pharmacistIds.filter(pid => {
          const days = args.pharmacistWorkingDays?.[pid as string];
          if (!days) return false; // handle null
          return days.includes(dayLabel);
        });
      }
      console.log(`[generateWeeklyRota] Generating rota for`, { i, dayLabel, isoDate, workingPharmacists });
      
      // Pass the combined duty counts to generateRota
      const response = await ctx.runMutation(internal.rotas.generateRota as any, {
        date: isoDate,
        pharmacistIds: workingPharmacists,
        clinicIds: args.clinicIds,
        dispensaryDutyCounts: { ...dispensaryDutyCounts }, // Pass current counts
        weeklyClinicAssignments: { ...weeklyClinicAssignments }, // NEW: Pass clinic assignment counts
        singlePharmacistDispensaryDays: args.singlePharmacistDispensaryDays,
        regenerateRota: args.regenerateRota,
        effectiveUnavailableRules: args.effectiveUnavailableRules, // Pass effective unavailable rules
        includedWeekdays: args.selectedWeekdays // Store which weekdays were included
      });
      
      // After rota is generated, update the counts for both regular dispensary shifts and lunch cover
      const rota = await ctx.db.get(response);
      if (rota && 'assignments' in rota && Array.isArray(rota.assignments)) {
        // Track any dispensary assignments (including lunch cover)
        // If this is for a day when the main dispensary pharmacist is working,
        // don't penalize them with increased counts for doing their main job
        const dispensaryAssignments = rota.assignments.filter((a: any) =>
          a.type === "dispensary"
        );
        
        // NEW: Track clinic assignments to avoid the same pharmacist covering multiple clinics in a week
        const clinicAssignments = rota.assignments.filter((a: any) =>
          a.type === "clinic"
        );
        
        // Update clinic assignment counts for the week
        clinicAssignments.forEach((assignment: any) => {
          const pid = assignment.pharmacistId;
          weeklyClinicAssignments[pid] = (weeklyClinicAssignments[pid] || 0) + 1;
          
          // Get the pharmacist name for logging
          const pharmacist = allPharmacists.find(p => p && p._id === pid);
          const pharmacistName = pharmacist ? pharmacist.name : pid;
          
          terminalLog(`[WEEKLY] Pharmacist ${pharmacistName} now has ${weeklyClinicAssignments[pid]} clinic assignment(s) this week`);
        });
        
        // Store daily assignment record for debugging
        dailyAssignments[dayLabel] = [];
        
        // Update all dispensary duty counts
        dispensaryAssignments.forEach((assignment: any) => {
          const pid = assignment.pharmacistId;
          // Get the pharmacist name for logging
          const pharmacist = allPharmacists.find(p => p && p._id === pid);
          const pharmacistName = pharmacist ? pharmacist.name : pid;
          
          // Record that this pharmacist has done a dispensary duty this week
          weeklyPharmacistDuties[pid] = true;
          
          // Add to daily assignment record
          dailyAssignments[dayLabel].push(`${pharmacistName} (${assignment.isLunchCover ? 'Lunch' : assignment.startTime + '-' + assignment.endTime})`);
          
          // Don't increase count for dispensary pharmacist doing regular shifts
          // But do count lunch cover for them
          if (dispensaryPharmacist && pid === dispensaryPharmacist._id && !assignment.isLunchCover) {
            // No penalty for main dispensary pharmacist doing their normal job
            console.log(`[generateWeeklyRota] Dispensary pharmacist ${dispensaryPharmacist.name} assigned regular shift (no count increase)`);
          } else {
            // For everyone else or for lunch cover duties, increment the count
            dispensaryDutyCounts[pid] = (dispensaryDutyCounts[pid] || 0) + 1;
          }
        });
        
        // Log the updated counts for debugging
        console.log(`[generateWeeklyRota] Updated dispensary duty counts after ${dayLabel}:`, dispensaryDutyCounts);
      }
      
      rotas.push(response);
      console.log(`[generateWeeklyRota] Created rotaId:`, response, 'for date:', isoDate);
    }
    
    // Log the final duty assignment pattern for the week
    console.log('[generateWeeklyRota] WEEKLY DUTY ASSIGNMENT SUMMARY:');
    Object.entries(dailyAssignments).forEach(([day, assignments]) => {
      console.log(`${day}: ${assignments.join(', ')}`);
    });
    
    return rotas;
  },
});

export const listRotas = query({
  args: {
    status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("archived")))
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("rotas");
    
    // Apply status filter if provided
    if (args.status) {
      query = query.filter(q => q.eq(q.field("status"), args.status));
    }
    
    return await query
      .order("desc")
      .collect();
  },
});

export const getRota = query({
  args: { rotaId: v.id("rotas") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.rotaId);
  },
});

export const deleteArchivedRotas = mutation({
  args: {
    // Allow deleting rotas for a specific week, or before a certain date
    weekStartDate: v.optional(v.string()),
    beforeDate: v.optional(v.string()),
    // Require admin confirmation to prevent accidental deletion
    adminConfirmation: v.string()
  },
  handler: async (ctx, args) => {
    // Verify admin confirmation is correct
    if (args.adminConfirmation !== "CONFIRM_DELETE_ARCHIVED_ROTAS") {
      throw new Error("Invalid admin confirmation. Please type CONFIRM_DELETE_ARCHIVED_ROTAS to proceed.");
    }
    
    let query = ctx.db
      .query("rotas")
      .filter(q => q.eq(q.field("status"), "archived"));
    
    // Add week filter if specified
    if (args.weekStartDate && typeof args.weekStartDate === 'string') {
      // Get the week end date (Sunday)
      const startDate = new Date(args.weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      const weekEndDate = endDate.toISOString().split('T')[0];
      
      // Filter by date range
      query = query.filter(q => 
        q.and(
          q.gte(q.field("date"), args.weekStartDate as string),
          q.lte(q.field("date"), weekEndDate)
        )
      );
      
      console.log(`[deleteArchivedRotas] Filtering by week: ${args.weekStartDate} to ${weekEndDate}`);
    }
    
    // Add before date filter if specified
    if (args.beforeDate && typeof args.beforeDate === 'string') {
      query = query.filter(q => q.lt(q.field("date"), args.beforeDate as string));
      console.log(`[deleteArchivedRotas] Filtering by before date: ${args.beforeDate}`);
    }
    
    // Get archived rotas
    const rotasToDelete = await query.collect();
    console.log(`[deleteArchivedRotas] Found ${rotasToDelete.length} archived rotas to delete`);
    
    // Delete each archived rota
    const deletedIds = [];
    for (const rota of rotasToDelete) {
      await ctx.db.delete(rota._id);
      deletedIds.push(rota._id);
      console.log(`[deleteArchivedRotas] Deleted rota ${rota._id} for date ${rota.date}`);
    }
    
    // Return summary of deleted rotas
    return {
      deletedCount: rotasToDelete.length,
      deletedIds: deletedIds,
      message: `Successfully deleted ${rotasToDelete.length} archived rotas.`
    };
  }
});

export const publishRota = mutation({
  args: { 
    rotaId: v.id("rotas"),
    userName: v.optional(v.string()),
    weekStartDate: v.string()
  },
  handler: async (ctx, args) => {
    const { rotaId, userName: providedUserName, weekStartDate } = args;
    console.log(`[publishRota] STARTING PUBLISH of rotaId: ${rotaId} for week starting ${weekStartDate}`);
    
    try {
      // Get the rota to publish as a reference
      const rotaToPublish = await ctx.db.get(rotaId);
      if (!rotaToPublish) throw new Error("Rota not found");
      
      const date = rotaToPublish.date;
      if (!date) throw new Error("Rota has no date");
      console.log(`[publishRota] Using reference rota for date: ${date}`);
      
      // Determine the user name to display
      let userName = "Unknown User";
      const identity = await ctx.auth.getUserIdentity();
      
      if (providedUserName) {
        userName = providedUserName;
      } else if (identity?.name) {
        userName = identity.name;
      } else if (identity?.email) {
        const email = identity.email;
        userName = email.split('@')[0]
          .split(/[._]/)
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      }
      
      // Get all DRAFT rotas for this week only
      console.log(`[publishRota] Finding all draft rotas for week starting ${weekStartDate}`);
      const rotasForWeek = await ctx.db.query("rotas")
        .filter(q => {
          // Logic to filter rotas by the same week and only draft status
          const rotaDate = q.field("date");
          const rotaStatus = q.field("status");
          // Use a string comparison for the week start date
          // This assumes the rotaDate strings are in YYYY-MM-DD format
          return q.and(
            q.eq(rotaStatus, "draft"),                     // only draft rotas
            q.gte(rotaDate, weekStartDate),               // rota date >= week start
            q.lt(rotaDate, addDays(weekStartDate, 7))     // rota date < week start + 7 days
          );
        })
        .collect();
        
      console.log(`[publishRota] Found ${rotasForWeek.length} rotas for week starting ${weekStartDate}`);
      
      // Create metadata for the published rota set
      const now = new Date();
      const publishedAt = now.toISOString(); 
      const formattedDate = now.toLocaleDateString();
      const formattedTime = now.toLocaleTimeString();
      
      // Create a unique ID for this published set
      const publishedSetId = `${weekStartDate}-${Date.now()}`;
      
      // Archive any previously published rotas for THIS WEEK
      console.log(`[publishRota] Finding any previously published rotas for week starting ${weekStartDate}`);
      const publishedRotasForSameWeek = await ctx.db.query("rotas")
        .filter(q => 
          q.and(
            q.eq(q.field("status"), "published"),
            q.gte(q.field("date"), weekStartDate),
            q.lt(q.field("date"), addDays(weekStartDate, 7))
          )
        )
        .collect();
      
      console.log(`[publishRota] Found ${publishedRotasForSameWeek.length} previously published rotas for week starting ${weekStartDate}`);
      
      // Archive previously published rotas
      if (publishedRotasForSameWeek.length > 0) {
        for (const prevRota of publishedRotasForSameWeek) {
          console.log(`[publishRota] Archiving previously published rota: ${prevRota._id} (${prevRota.date})`);
          await ctx.db.patch(prevRota._id, { status: "archived" });
        }
      }
      
      // Create a new set of published rotas (as carbon copies)
      const publishedRotaIds = [];
      
      for (const rota of rotasForWeek) {
        // Create a new document that is a carbon copy, but with published status
        console.log(`[publishRota] Creating carbon copy of rota ${rota._id} for date ${rota.date}`);
        
        // Create a new rota document with all the same data plus publication metadata
        // Extract fields from the original rota, excluding _id and _creationTime
        const { _id, _creationTime, ...rotaData } = rota;
        
        const newRotaId = await ctx.db.insert("rotas", {
          ...rotaData,      // Copy all relevant fields from original
          originalRotaId: rota._id,  // Reference to the original rota
          status: "published",
          publishedBy: userName,
          publishedAt: publishedAt,
          publishDate: formattedDate,
          publishTime: formattedTime,
          publishedSetId: publishedSetId  // Track which published set this belongs to
        });
        
        publishedRotaIds.push(newRotaId);
      }
      
      console.log(`[publishRota] Successfully published ${publishedRotaIds.length} rotas for week starting ${weekStartDate}`);
      console.log(`[publishRota] Published by: ${userName} at ${formattedDate} ${formattedTime}`);
      console.log(`[publishRota] Published set ID: ${publishedSetId}`);
      
      return { 
        publishedRotaIds,
        publishedSetId
      };
      
    } catch (error) {
      console.error(`[publishRota] ERROR publishing rota ${rotaId}:`, error);
      throw error;
    }
  },
});

// Helper function to add days to a date string
function addDays(dateString: string, days: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// Function to save free cell text to a rota
export const saveFreeCellText = mutation({
  args: { 
    rotaId: v.id("rotas"),
    freeCellText: v.record(v.string(), v.string())
  },
  handler: async (ctx, args) => {
    const { rotaId, freeCellText } = args;
    
    // Get the rota
    const rota = await ctx.db.get(rotaId);
    if (!rota) {
      throw new Error(`Rota with ID ${rotaId} not found`);
    }
    
    console.log(`[saveFreeCellText] Saving free cell text for rota ${rotaId}:`, freeCellText);
    
    // Update the rota with the free cell text
    await ctx.db.patch(rotaId, { freeCellText });
    
    return { success: true };
  }
});
// New mutation to update only the pharmacist for a specific assignment ID
export const updatePharmacistForAssignment = mutation({
  args: {
    assignmentId: v.id("rotaAssignments"),
    newPharmacistId: v.id("pharmacists"),
    rotaId: v.id("rotas"), // Include rotaId to potentially update the parent rota's lastEdited or similar
  },
  handler: async (ctx, args) => {
    const { assignmentId, newPharmacistId, rotaId } = args;

    // Fetch the assignment to ensure it exists
    const assignment = await ctx.db.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment with ID ${assignmentId} not found.`);
    }

    // Check if the rota exists and if the assignment belongs to it (optional, but good practice)
    const rota = await ctx.db.get(rotaId);
    if (!rota) {
      throw new Error(`Rota with ID ${rotaId} not found.`);
    }
    // This check assumes rotaAssignments are stored directly or referenced in a way
    // that can be validated. If assignments are sub-documents, this check needs adjustment.
    // For now, we'll trust the rotaId passed from the client is correct.

    // Update the pharmacistId for the specific assignment
    await ctx.db.patch(assignmentId, { pharmacistId: newPharmacistId });

    // Optionally, update the parent rota document (e.g., lastEdited timestamp)
    // This depends on your application's needs.
    await ctx.db.patch(rotaId, { lastEdited: new Date().toISOString() });
    
    console.log(`[updatePharmacistForAssignment] Updated assignment ${assignmentId} to pharmacist ${newPharmacistId} in rota ${rotaId}`);

    return { success: true, updatedAssignmentId: assignmentId };
  },
});
export const updateRotaAssignment = mutation({
  args: {
    rotaId: v.id("rotas"),
    assignmentIndex: v.number(),
    pharmacistId: v.id("pharmacists"),
    newAssignment: v.optional(v.object({
      location: v.string(),
      type: v.union(v.literal("ward"), v.literal("dispensary"), v.literal("clinic"), v.literal("management")),
      startTime: v.string(),
      endTime: v.string(),
      isLunchCover: v.optional(v.boolean())
    }))
  },
  handler: async (ctx, args) => {
    const { rotaId, assignmentIndex, pharmacistId, newAssignment } = args;

    // Get the current rota
    const rota = await ctx.db.get(rotaId);
    if (!rota) {
      throw new Error("Rota not found");
    }

    // Create a new array of assignments
    const assignments = [...rota.assignments];

    if (newAssignment) {
      // If this is a new assignment, add it to the array
      assignments.push({
        pharmacistId,
        location: newAssignment.location,
        type: newAssignment.type,
        startTime: newAssignment.startTime,
        endTime: newAssignment.endTime,
        isLunchCover: newAssignment.isLunchCover
      });
    } else {
      // Otherwise update the existing assignment
      if (assignmentIndex >= assignments.length) {
        throw new Error("Assignment index out of bounds");
      }

      assignments[assignmentIndex] = {
        ...assignments[assignmentIndex],
        pharmacistId
      };
    }

    // Update the rota with the new assignments array
    await ctx.db.patch(rotaId, {
      assignments
    });

    return rotaId;
  }
});

export const archiveRotas = mutation({
  args: { 
    weekStartDate: v.string(),
    archiveAll: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const { weekStartDate, archiveAll = false } = args;
        
    // Query for rotas to archive
    let weekRotas;
    if (archiveAll) {
      // Archive all rotas for this week
      weekRotas = await ctx.db
        .query("rotas")
        .filter(q => q.eq(q.field("status"), "published"))
        .collect();
    } else {
      // Archive only the specific week
      weekRotas = await ctx.db
        .query("rotas")
        .filter(q => 
          q.and(
            q.eq(q.field("status"), "published"),
            q.gte(q.field("date"), weekStartDate),
            q.lt(q.field("date"), addDays(weekStartDate, 7))
          )
        )
        .collect();
    }
        
    console.log(`[archiveRotas] Archiving ${weekRotas.length} rotas`);
        
    // Update all matching rotas to 'archived' status
    for (const rota of weekRotas) {
      await ctx.db.patch(rota._id, { status: "archived" });
    }
        
    console.log(`[archiveRotas] Archived ${weekRotas.length} rotas for week starting ${weekStartDate}`);
        
    // Return the IDs of the archived rotas
    return weekRotas.map(rota => rota._id);
  },
});

// Save rota configuration to allow resuming work later
export const saveRotaConfiguration = mutation({
  args: {
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
    userName: v.optional(v.string()),
    isGenerated: v.boolean() // Whether a rota has been generated using this configuration
  },
  handler: async (ctx, args) => {
    console.log(`[saveRotaConfiguration] Saving configuration for week starting: ${args.weekStartDate}`);
        
    // Check if a configuration for this week already exists
    const existingConfig = await ctx.db
      .query("rotaConfigurations")
      .withIndex("by_weekStartDate", q => q.eq("weekStartDate", args.weekStartDate))
      .first();
        
    // If configuration exists, update it
    if (existingConfig) {
      console.log(`[saveRotaConfiguration] Updating existing configuration for ${args.weekStartDate}`);
      return ctx.db.patch(existingConfig._id, {
        selectedClinicIds: args.selectedClinicIds,
        selectedPharmacistIds: args.selectedPharmacistIds,
        selectedWeekdays: args.selectedWeekdays,
        pharmacistWorkingDays: args.pharmacistWorkingDays,
        singlePharmacistDispensaryDays: args.singlePharmacistDispensaryDays,
        ignoredUnavailableRules: args.ignoredUnavailableRules || {},
        rotaUnavailableRules: args.rotaUnavailableRules || {},
        lastModified: Date.now(),
        lastModifiedBy: args.userName || "Unknown user",
        rotaGeneratedAt: args.isGenerated ? Date.now() : existingConfig.rotaGeneratedAt,
        isGenerated: args.isGenerated || existingConfig.isGenerated
      });
    }
        
    // Otherwise, create a new configuration
    console.log(`[saveRotaConfiguration] Creating new configuration for ${args.weekStartDate}`);
    return ctx.db.insert("rotaConfigurations", {
      weekStartDate: args.weekStartDate,
      selectedClinicIds: args.selectedClinicIds,
      selectedPharmacistIds: args.selectedPharmacistIds,
      selectedWeekdays: args.selectedWeekdays,
      pharmacistWorkingDays: args.pharmacistWorkingDays,
      singlePharmacistDispensaryDays: args.singlePharmacistDispensaryDays,
      ignoredUnavailableRules: args.ignoredUnavailableRules || {},
      rotaUnavailableRules: args.rotaUnavailableRules || {},
      lastModified: Date.now(),
      lastModifiedBy: args.userName || "Unknown user",
      rotaGeneratedAt: args.isGenerated ? Date.now() : undefined,
      isGenerated: args.isGenerated
    });
  }
});

// Retrieve a saved rota configuration for a specific week
export const getRotaConfiguration = query({
  args: {
    weekStartDate: v.string() // Monday date in YYYY-MM-DD format
  },
  handler: async (ctx, args) => {
    console.log(`[getRotaConfiguration] Looking for configuration for week starting: ${args.weekStartDate}`);
        
    // Look up configuration for this week
    const config = await ctx.db
      .query("rotaConfigurations")
      .withIndex("by_weekStartDate", q => q.eq("weekStartDate", args.weekStartDate))
      .first();
        
    if (config) {
      console.log(`[getRotaConfiguration] Found configuration for ${args.weekStartDate}`);
    } else {
      console.log(`[getRotaConfiguration] No configuration found for ${args.weekStartDate}`);
    }
        
    return config;
  }
});
