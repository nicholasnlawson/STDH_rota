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
    // --- ROTA GENERATION SCAFFOLD ---
    const assignments: Assignment[] = [];
    const conflicts: Conflict[] = [];

    // Ensure dayLabel is available in all relevant scopes
    // Move the dayLabel declaration to a higher scope so all filters (including lunch cover and dispensary) can use it
    // Place this after parsing args.date, before any assignments/filters
    const dayLabel = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date(args.date).getDay()];

    // 1. CLINICS - prioritize clinics above all else
    if (clinics && clinics.length > 0) {
      console.log('[generateRota] Clinics to cover:', clinics.map(clinic => `${clinic.name} (${clinic.dayOfWeek}) preferredPharmacists:${JSON.stringify(clinic.preferredPharmacists || [])}`));
      
      // Filter for clinics on this specific day (dayOfWeek)
      const dayOfWeek = new Date(args.date).getDay() || 7; // Convert Sunday (0) to 7
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
            const band67Pharmacists = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained
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
            
            // Check time conflicts for each clinic assignment
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
            const band8aPharmacists = workingPharmacists.filter(p => 
              p && 
              p.band === "8a" && 
              p.warfarinTrained
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
            // Get band 6/7 pharmacists who have at least 1 clinic already
            const band67PharmacistsWithClinics = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained && 
              (weeklyClinicCounts[p._id] || 0) > 0
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
            const availableBand67WithClinics = band67PharmacistsWithClinics.filter(p => {
              if (!p) return false;
              
              // Check if this pharmacist is already assigned to a clinic at this time
              const timeKey = `${clinic.startTime}-${clinic.endTime}`;
              return !assignedPharmacistsByTime[timeKey]?.includes(p._id) && !isPharmacistNotAvailable(p, dayLabel, clinic.startTime, clinic.endTime);
            }).sort((a, b) => {
              if (!a || !b) return 0;
              const countA = weeklyClinicCounts[a._id] || 0;
              const countB = weeklyClinicCounts[b._id] || 0;
              return countA - countB;
            });
            
            terminalLog(`STRATEGY 4: Checking band 6/7 pharmacists who already have clinics:`, 
              availableBand67WithClinics.map(p => p ? { 
                name: p.name, 
                band: p.band, 
                warfarinTrained: p.warfarinTrained,
                weeklyClinicCount: weeklyClinicCounts[p._id] || 0
              } : null).filter(Boolean)
            );
            
            if (availableBand67WithClinics.length > 0) {
              const pharmacist = availableBand67WithClinics[0];
              if (pharmacist) {
                console.log(`[generateRota] SUCCESS: Assigned band 6/7 pharmacist ${pharmacist.name} (already has ${weeklyClinicCounts[pharmacist._id] || 0} clinic(s)) to clinic ${clinic.name}`);
                
                terminalLog(`SUCCESS! Assigned band 6/7 pharmacist ${pharmacist.name} (already has ${weeklyClinicCounts[pharmacist._id] || 0} clinic(s)) to clinic ${clinic.name}`);
                
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
            const band67Pharmacists = workingPharmacists.filter(p => 
              p && 
              (p.band === "6" || p.band === "7") && 
              p.warfarinTrained
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
    const lunchSlot = { start: "13:30", end: "14:00" };
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
          !hasClinicConflict(p._id, lunchSlot.start, lunchSlot.end, assignments) &&
          !isPharmacistNotAvailable(p, dayLabel, lunchSlot.start, lunchSlot.end) &&
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
            startTime: lunchSlot.start,
            endTime: lunchSlot.end,
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
      // Check single pharmacist mode for days without dispensary pharmacist
      const isSinglePharmacistMode = Array.isArray(args.singlePharmacistDispensaryDays) && 
                                    args.singlePharmacistDispensaryDays.includes(args.date);

      if (isSinglePharmacistMode) {
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
            )
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
              )
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
              )
            );
          }
          
          // RANDOMIZE among eligible juniors
          juniors = shuffleArray(juniors);
          return juniors[0] || null;
        };
        
        // Get the junior pharmacist to cover all day
        const mainPharmacist = getJuniorPharmacists();
        
        if (mainPharmacist) {
          // Assign main pharmacist to all shifts except lunch
          dispensaryShifts.forEach(shift => {
            if (!(shift.start === "13:00" && shift.end === "15:00")) { // not lunch
              assignments.push({
                pharmacistId: mainPharmacist?._id, // Add null check
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
            p._id !== mainPharmacist?._id && // Add null check
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            p.band !== "Dispensary Pharmacist" && // Exclude dispensary pharmacists
            !warfarinClinicPharmacists.has(p._id) &&
            !hasClinicConflict(p._id, lunchSlot.start, lunchSlot.end, assignments) &&
            !isPharmacistNotAvailable(p, dayLabel, lunchSlot.start, lunchSlot.end)
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
              const aCount = args.dispensaryDutyCounts ? args.dispensaryDutyCounts[a._id] || 0 : 0;
              const bCount = args.dispensaryDutyCounts ? args.dispensaryDutyCounts[b._id] || 0 : 0;
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
                startTime: lunchSlot.start,
                endTime: lunchSlot.end,
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
        // Original multiple-pharmacist logic for days without dispensary pharmacist
        console.log('[generateRota] Using multiple-pharmacist mode for dispensary coverage');
        
        // First, handle lunch cover separately - we want to prioritize senior pharmacists and 
        // those with warfarin clinic duties for this shorter 30-minute slot
        const lunchSlot = { start: "13:30", end: "14:00" };
        
        // Find eligible pharmacists for lunch cover, prioritizing:
        // 1. Senior pharmacists (band 8a)
        // 2. Pharmacists with warfarin clinic duties (if they're available during lunch)
        // 3. Junior pharmacists (band 6/7) as a last resort
        
        // Get senior pharmacists first for lunch
        let lunchCoverCandidates = pharmacists.filter(p => 
          p && 
          args.pharmacistIds.includes(p._id) && 
          p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
          p.band === "8a" // Senior pharmacists first
        );
        
        // If no senior pharmacists available, try warfarin-trained pharmacists who aren't assigned to warfarin clinics today
        if (lunchCoverCandidates.length === 0) {
          lunchCoverCandidates = pharmacists.filter(p => 
            p && 
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            p.warfarinTrained &&
            !warfarinClinicPharmacists.has(p._id) && // Not already assigned to a warfarin clinic today
            !hasClinicConflict(p._id, lunchSlot.start, lunchSlot.end, assignments) &&
            !isPharmacistNotAvailable(p, dayLabel, lunchSlot.start, lunchSlot.end)
          );
        }
        
        // If still no candidates, use any available pharmacist for lunch
        if (lunchCoverCandidates.length === 0) {
          lunchCoverCandidates = pharmacists.filter(p => 
            p && 
            args.pharmacistIds.includes(p._id) && 
            p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
            !hasClinicConflict(p._id, lunchSlot.start, lunchSlot.end, assignments) &&
            !isPharmacistNotAvailable(p, dayLabel, lunchSlot.start, lunchSlot.end)
          );
        }
        
        // Shuffle candidates to ensure random selection among equals
        lunchCoverCandidates = shuffleArray(lunchCoverCandidates);
        
        // Assign lunch cover if we have a candidate
        if (lunchCoverCandidates.length > 0) {
          const lunchCoverPharmacist = lunchCoverCandidates[0];
          if (lunchCoverPharmacist) { // Add null check
            assignments.push({
              pharmacistId: lunchCoverPharmacist._id,
              type: "dispensary",
              location: "Dispensary (Lunch Cover)",
              startTime: lunchSlot.start,
              endTime: lunchSlot.end,
              isLunchCover: true
            });
            console.log(`[generateRota] Assigned ${lunchCoverPharmacist.name} to lunch cover`);
          }
        } else {
          conflicts.push({
            type: "dispensary",
            description: "No pharmacist available for dispensary lunch cover.",
            severity: "warning"
          });
        }
        
        // Now handle the regular 2-hour dispensary shifts
        // We will specifically exclude the lunchSlot which is now handled separately
        let regularDispensaryShifts = dispensaryShifts.filter(shift => 
          !(shift.start === "13:00" && shift.end === "15:00")
        );
        
        // Calculate how many shifts need to be assigned
        const totalShifts = regularDispensaryShifts.length;
        
        // Band 6/7 preferred, Band 8 only if needed
        let juniorPharmacists = pharmacists.filter(p => 
          p && 
          args.pharmacistIds.includes(p._id) && 
          p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
          (p.band === "6" || p.band === "7") // Band 6 and 7 pharmacists
        );
        
        // Senior pharmacists (band 8a) are only used if needed
        let seniorPharmacists = pharmacists.filter(p => 
          p && 
          args.pharmacistIds.includes(p._id) && 
          p.band !== "EAU Practitioner" && // Exclude EAU Practitioner pharmacists
          p.band === "8a" // Band 8a pharmacists
        );
        
        let eligiblePharmacists: (Doc<"pharmacists"> | null)[] = [];
        
        // If junior pharmacists can cover all slots, use only them
        if (juniorPharmacists.length >= totalShifts) {
          eligiblePharmacists = [...juniorPharmacists];
          console.log('[generateRota] Using only junior pharmacists (bands 6-7) for dispensary shifts');
        } else {
          // Otherwise, use all junior pharmacists and add enough senior pharmacists to cover remaining slots
          eligiblePharmacists = [...juniorPharmacists, ...seniorPharmacists];
          console.log('[generateRota] Using both junior and senior pharmacists for dispensary shifts');
        }
        
        // Filter out pharmacists with a clinic conflict
        eligiblePharmacists = eligiblePharmacists.filter(p =>
          p && !regularDispensaryShifts.some(shift => 
            hasClinicConflict(p._id, shift.start, shift.end, assignments) || 
            isPharmacistNotAvailable(p, dayLabel, shift.start, shift.end)
          )
        );
        
        // Exclude warfarin clinic pharmacists from dispensary shift eligibility
        eligiblePharmacists = eligiblePharmacists.filter(p =>
          p && !warfarinClinicPharmacists.has(p._id)
        );
        
        // LOG: Eligible pharmacists for dispensary
        console.log('[generateRota] Eligible pharmacists for dispensary:', eligiblePharmacists.map(p => p?.name || p?._id));
        
        // Shuffle within each group to ensure random selection among equals
        eligiblePharmacists = shuffleArray(eligiblePharmacists);
        
        // Assign each shift to a unique pharmacist if possible
        // First, try to assign all shifts with one pharmacist per shift
        let remainingShifts = [...regularDispensaryShifts]; // Using only regular shifts, not lunch
        while (remainingShifts.length > 0 && eligiblePharmacists.length > 0) {
          // LOG: Start of shift assignment iteration
          console.log('[generateRota] Remaining shifts:', remainingShifts);
          // If we have enough pharmacists, assign each to only one shift
          // Sort our pharmacists by how many shifts they already have
          const shiftCounts: Record<string, number> = {};
          assignments.forEach(a => {
            shiftCounts[a.pharmacistId] = (shiftCounts[a.pharmacistId] || 0) + 1;
          });
          // LOG: Current shiftCounts
          console.log('[generateRota] Current shiftCounts:', shiftCounts);
          // Sort eligiblePharmacists by those with fewest assignments
          const sortedPharmacists = [...eligiblePharmacists].sort((a, b) => {
            // This guard should already handle nulls, but TS seems unsure
            if (!a || !b) return 0;
            const aCount = shiftCounts[a._id] || 0;
            const bCount = shiftCounts[b._id] || 0;
            return aCount - bCount;
          });
          console.log('[generateRota] Sorted pharmacists by fewest assignments:', sortedPharmacists.map(p => p?.name || p?._id));
          if (sortedPharmacists.length === 0) break;
          // Assign the next shift to the pharmacist with fewest assignments so far
          const shift = remainingShifts.shift(); // Take the next shift
          if (!shift) break;
          const leastAssignedPharmacist = sortedPharmacists[0];
          // Add null check before accessing properties
          if (!leastAssignedPharmacist) continue; // Skip if no pharmacist found
          assignments.push({ 
            pharmacistId: leastAssignedPharmacist._id, 
            type: "dispensary",
            location: "Dispensary",
            startTime: shift.start,
            endTime: shift.end
          });
          // LOG: Assignment made
          console.log('[generateRota] Assigned shift', shift, 'to', leastAssignedPharmacist.name || leastAssignedPharmacist._id);
        }
        // LOG: Final shift assignments for this day
        console.log('[generateRota] Final shift assignments:', assignments);
      }
    }
    
    // --- 3. WARD ASSIGNMENTS ---
    // Build list of active wards with directorate
    const activeWards = directorates.flatMap(d =>
      d.wards.filter(w => w.isActive).map(w => ({ ...w, directorate: d.name }))
    );

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
      p && p.band !== "Dispensary Pharmacist" && p.band !== "EAU Practitioner"
    ) as NonNullable<typeof pharmacists[0]>[];

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
    const wardsByDirectorate: Record<string, any[]> = {};
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
      
      // Special handling for band 6 pharmacists - we should try to "bump" a band 7 from this directorate
      // to make room if possible
      if (!targetWard && p.band === "6") {
        console.log(`[generateRota] PASS 1: No available wards in ${p.primaryDirectorate} for band 6 ${p.name} - checking if we can reassign a band 7`);
        
        // Check for any band 7 pharmacists who have been assigned to this directorate already
        const directorate = p.primaryDirectorate;
        interface PharmacistAssignment {
          assignment: Assignment;
          pharmacist: NonNullable<(typeof pharmacists)[0]>;
          ward: any;
          isPrimaryWard: boolean;
          isDefault: boolean;
        }
        
        const band7PharmacistsInThisDir: PharmacistAssignment[] = assignments
          .filter(a => a.type === "ward")
           .map(a => {
             const ward = activeWards.find(w => w.name === a.location);
             if (ward && ward.directorate === directorate) {
               const pharmacist = pharmacists.find(ph => ph && ph._id === a.pharmacistId);
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
          // 1. First move non-default pharmacists
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
          
          console.log(`[generateRota] PASS 1: Found band 7 ${targetToReplace.pharmacist.name} in ${directorate} who could be moved (${moveReason}) to make room for band 6 ${p.name}`);
          
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
      
      // Skip if pharmacist is not available
      if (isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) {
        console.log(`[generateRota] PASS 1: Skipping ${p.name} - not available on ${dayLabel}`);
        return;
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
      
      // Try to assign at least one pharmacist to this empty directorate
      const candidates = wardPharmacists
        .filter(p => !isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59"))
        .filter(p => p.band !== "8a" || p.primaryDirectorate === directorate)
        .sort((a, b) => {
          // First prioritize band 7 pharmacists over band 6 for being moved outside primary directorate
          const aIsBand7 = a.band === "7" ? -5 : 0;
          const bIsBand7 = b.band === "7" ? -5 : 0;
          const bandDiff = aIsBand7 - bIsBand7;
          
          // If band differences exist, prioritize by that
          if (bandDiff !== 0) return bandDiff;
          
          // Prefer pharmacists trained in this directorate
          const aTrainedInDir = a.trainedDirectorates?.includes(directorate) ? -10 : 0;
          const bTrainedInDir = b.trainedDirectorates?.includes(directorate) ? -10 : 0;
          return (aTrainedInDir - bTrainedInDir);
        });
      
      console.log(`[generateRota] PASS 2: Candidates for empty directorate ${directorate} prioritizing band 7 over 6:`, 
        candidates.map(p => `${p.name} (Band ${p.band}${p.trainedDirectorates?.includes(directorate) ? ', trained' : ''})`));
      
      if (candidates.length > 0) {
        const chosenPharmacist = candidates[0];
        const targetWard = dirWards[0]; // Pick first ward in empty directorate
        
        // Make assignment
        assignments.push({
          pharmacistId: chosenPharmacist._id,
          type: "ward",
          location: targetWard.name,
          startTime: "00:00",
          endTime: "23:59"
        });
        
        // Remove pharmacist from pool
        wardPharmacists = wardPharmacists.filter(p => p._id !== chosenPharmacist._id);
        
        // Mark directorate as filled
        directoratesFilled[directorate] = true;
      }
    }
    
    console.log(`[generateRota] PASS 2: Completed. ${wardPharmacists.length} pharmacists remaining unassigned`);

    // PASS 3: Ensure minimum pharmacists per ward
    for (const w of activeWards) {
      let assignedCount = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
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
      const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
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
            const aTrainedInDir = a.trainedDirectorates?.includes(directorate) ? -10 : 0;
            const bTrainedInDir = b.trainedDirectorates?.includes(directorate) ? -10 : 0;
            return (aTrainedInDir - bTrainedInDir);
          });
        
        if (candidates.length > 0) {
          const chosenPharmacist = candidates[0];
          const targetWard = dirWards[0];
          
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
    
    console.log(`[generateRota] PASS 4.5: Sorting remaining pharmacists to prioritize band 7 for movement:`, 
      remainingPharmacistsSorted.map(p => 
        `${p.name} (Band ${p.band}${p.isDefaultPharmacist ? ', Default' : ''})`
      ));
    
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
            console.log(`[generateRota] PASS 4.5: No available wards for Band 8a ${p.name} in primary directorate ${p.primaryDirectorate} - assigning to Management Time`);
            
            // Assign to Management Time instead
            assignments.push({
              pharmacistId: p._id,
              type: "management",
              location: "Management Time",
              startTime: "00:00",
              endTime: "23:59"
            });
            
            assigned = true;
            console.log(`[generateRota] PASS 4.5: Assigned Band 8a ${p.name} to Management Time`);
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
              console.log(`[generateRota] PASS 4.5: Assigned ${p.name} to ${w.name} in trained directorate ${dir}`);
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
            console.log(`[generateRota] PASS 4.5: Assigned ${p.name} to ${w.name} (any available ward)`);
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

    // PASS 5: Assign remaining pharmacists to their primary directorate if possible
    for (const p of [...wardPharmacists]) {
      if (!p.primaryDirectorate || isPharmacistNotAvailable(p, dayLabel, "00:00", "23:59")) continue;
      
      const dirWards = wardsByDirectorate[p.primaryDirectorate] || [];
      if (dirWards.length === 0) continue;
      
      // Sort wards by preference (primary wards first, then others)
      const sortedWards = [...dirWards].sort((a, b) => {
        const aIsPrimary = p.primaryWards?.includes(a.name) ? -10 : 0;
        const bIsPrimary = p.primaryWards?.includes(b.name) ? -10 : 0;
        return aIsPrimary - bIsPrimary;
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
      const count = assignments.filter(a => a.type === "ward" && a.location === w.name).length;
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
      conflicts,
    });
  },
});

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
  if (!pharmacist || !pharmacist.notAvailableRules) return false;
  return pharmacist.notAvailableRules.some((rule: {dayOfWeek: string; startTime: string; endTime: string;}) => {
    if (rule.dayOfWeek !== dayLabel) return false;
    // If slot overlaps with not available rule
    return !(slotEnd <= rule.startTime || slotStart >= rule.endTime);
  });
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

export const generateWeeklyRota = mutation({
  args: {
    startDate: v.string(), // Monday date (YYYY-MM-DD)
    pharmacistIds: v.array(v.id("pharmacists")),
    clinicIds: v.optional(v.array(v.id("clinics"))),
    pharmacistWorkingDays: v.optional(v.record(v.string(), v.array(v.string()))),
    singlePharmacistDispensaryDays: v.optional(v.array(v.string())),
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
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("rotas")
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

export const publishRota = mutation({
  args: { rotaId: v.id("rotas") },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.rotaId, {
      status: "published",
    });
  },
});
