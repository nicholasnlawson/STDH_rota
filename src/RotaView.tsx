import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { PharmacistSelectionModal } from "./PharmacistSelectionModal";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLINIC_DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function RotaView() {
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const generateWeeklyRota = useMutation(api.rotas.generateWeeklyRota);
  const updateAssignment = useMutation(api.rotas.updateRotaAssignment);
  const clinics = useQuery(api.clinics.listClinics) || [];
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  const [selectedClinicIds, setSelectedClinicIds] = useState<Array<Id<"clinics">>>([]);
  const [selectedPharmacistIds, setSelectedPharmacistIds] = useState<Array<Id<"pharmacists">>>(() => {
    // Preselect default pharmacists
    return (pharmacists.filter((p: any) => p.isDefaultPharmacist).map((p: any) => p._id) || []);
  });
  const [selectedMonday, setSelectedMonday] = useState("");
  const [generatingWeekly, setGeneratingWeekly] = useState(false);
  const [showClinicSelection, setShowClinicSelection] = useState(false);
  const [showPharmacistSelection, setShowPharmacistSelection] = useState(false);
  const [rotaGenerated, setRotaGenerated] = useState(false);
  const [pharmacistWorkingDays, setPharmacistWorkingDays] = useState<Record<string, string[]>>({});
  const allRotas = useQuery(api.rotas.listRotas) || [];
  const [rotaAssignments, setRotaAssignments] = useState<any[]>([]);
  const [rotaIdsByDate, setRotaIdsByDate] = useState<Record<string, Id<"rotas">>>({});
  const [rotaUnavailableRules, setRotaUnavailableRules] = useState<Record<string, { dayOfWeek: string, startTime: string, endTime: string }[]>>({});
  const [singlePharmacistDispensaryDays, setSinglePharmacistDispensaryDays] = useState<string[]>([]);
  const [pharmacistSearch, setPharmacistSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<{
    rotaId: Id<"rotas">,
    assignmentIndices: number[],
    currentPharmacistId: Id<"pharmacists"> | null,
    location: string,
    date: string,
    startTime?: string,
    endTime?: string,
    newAssignment?: {
      location: string,
      type: "ward" | "dispensary" | "clinic" | "management",
      startTime: string,
      endTime: string,
      isLunchCover?: boolean
    }
  } | null>(null);

  // Log rotaAssignments changes
  useEffect(() => {
    console.log('[useEffect rotaAssignments] Rota assignments updated:', rotaAssignments);
  }, [rotaAssignments]);

  // Helper: Get all wards with directorate info
  const allWards = directorates.flatMap((d: any) => (d.wards || []).filter((w: any) => w.isActive).map((w: any) => ({...w, directorate: d.name})));

  // Define rota time slots
  const TIME_SLOTS = [
    { start: "09:00", end: "11:00" },
    { start: "11:00", end: "13:00" },
    { start: "13:00", end: "15:00" },
    { start: "15:00", end: "17:00" },
  ];

  // Helper: get assignments for a given day, ward, and slot
  function getWardAssignment(
    date: string,
    ward: string,
    slot: { start: string; end: string }
  ) {
    const found = rotaAssignments.find(a =>
      a.type === "ward" &&
      a.date === date &&
      a.location === ward &&
      a.startTime <= slot.start &&
      a.endTime >= slot.end
    );
    console.log('[getWardAssignment]', found ? "Found:" : "Not found:", { date, ward, slot, found });
    return found;
  }

  // Helper: get assignments for clinic for a given date and clinic
  function getClinicAssignment(
    date: string,
    clinicName: string
  ) {
    const found = rotaAssignments.find(a =>
      a.type === "clinic" &&
      a.date === date &&
      a.location === clinicName
    );
    
    console.log('[getClinicAssignment]', found ? "Found:" : "Not found:", { date, clinicName, found });
    return found;
  }

  // Helper: get assignments for dispensary for a given date and slot
  function getDispensaryAssignment(
    date: string,
    slot: { start: string; end: string }
  ) {
    // First try to find an exact match for the time slot
    const found = rotaAssignments.find(a =>
      a.date === date &&
      a.type === "dispensary" &&
      a.startTime === slot.start &&
      a.endTime === slot.end
    );
    
    if (found) {
      console.log('[getDispensaryAssignment] Found:', { date, slot, found });
      return found;
    } else {
      // Check if this is a lunch slot by trying to find a lunch cover assignment
      const lunchCover = rotaAssignments.find(a =>
        a.date === date &&
        a.type === "dispensary" &&
        a.isLunchCover === true &&
        a.startTime <= slot.end &&
        a.endTime >= slot.start
      );
      
      if (lunchCover) {
        console.log('[getDispensaryAssignment] Found lunch cover:', { date, slot, lunchCover });
        return lunchCover;
      }
      
      // If no exact match and not a lunch slot, check if there's a regular dispensary assignment
      // that overlaps with this slot (e.g., a pharmacist assigned for the whole day)
      const overlapping = rotaAssignments.find(a =>
        a.date === date &&
        a.type === "dispensary" &&
        !a.isLunchCover &&
        a.startTime <= slot.start &&
        a.endTime >= slot.end
      );
      
      if (overlapping) {
        console.log('[getDispensaryAssignment] Found overlapping:', { date, slot, overlapping });
        return overlapping;
      }
      
      console.log('[getDispensaryAssignment] Not found:', { date, slot });
      return undefined;
    }
  }

  // Helper: get pharmacist name
  function getPharmacistName(pharmacistId: string) {
    // Define a more complete type for pharmacist that includes our new fields
    type PharmacistWithDisplayName = {
      _id: Id<"pharmacists">;
      name: string;
      displayName?: string;
      firstName?: string;
      lastName?: string;
      [key: string]: any; // For other properties we don't need to specify here
    };
    
    const p = pharmacists.find((p: PharmacistWithDisplayName) => p._id === pharmacistId);
    if (!p) return "";
  
    // Use displayName if available, otherwise fall back to the legacy name field
    return p.displayName || p.name;
  }

  // Helper: Get unavailable pharmacists for a given day
  function getUnavailablePharmacists(dateStr: string) {
    const date = new Date(dateStr);
    const dayLabel = DAYS[date.getDay()];
    return pharmacists.filter((p: any) => {
      if (!p.notAvailableRules || !Array.isArray(p.notAvailableRules)) return false;
      // If any rule matches this day
      return p.notAvailableRules.some((rule: any) => rule.dayOfWeek === dayLabel);
    });
  }

  // Helper: Get unavailable pharmacists for a given day
  function isPharmacistNotAvailable(pharmacist: any, dayLabel: string, slot: { start: string, end: string }) {
    return getAllUnavailableRules(pharmacist).some((rule: any) =>
      rule.dayOfWeek === dayLabel && !(slot.end <= rule.startTime || slot.start >= rule.endTime)
    );
  }

  // Helper: get all unavailable rules (permanent + rota-specific)
  function getAllUnavailableRules(pharmacist: any) {
    return [
      ...(pharmacist.notAvailableRules || []),
      ...(rotaUnavailableRules[pharmacist._id] || [])
    ];
  }

  // Helper: get all unavailable rules (permanent + rota-specific)
  function addRotaUnavailableRule(pharmacistId: string, rule: { dayOfWeek: string, startTime: string, endTime: string }) {
    setRotaUnavailableRules(prev => {
      const rules = prev[pharmacistId] || [];
      return { ...prev, [pharmacistId]: [...rules, rule] };
    });
  }
  // Helper to remove a rota-specific unavailable rule
  function removeRotaUnavailableRule(pharmacistId: string, idx: number) {
    setRotaUnavailableRules(prev => {
      const rules = (prev[pharmacistId] || []).slice();
      rules.splice(idx, 1);
      return { ...prev, [pharmacistId]: rules };
    });
  }

  // Helper: check if a pharmacist has overlapping assignments (ward with clinic or dispensary)
  function hasOverlappingAssignments(
    pharmacistId: Id<"pharmacists">,
    date: string,
    timeSlot: { start: string; end: string }
  ) {
    // Check if pharmacist has a ward assignment for this time slot
    const wardAssignment = rotaAssignments.find(a =>
      a.type === "ward" &&
      a.date === date &&
      a.pharmacistId === pharmacistId &&
      a.startTime <= timeSlot.start &&
      a.endTime >= timeSlot.end
    );

    if (!wardAssignment) return false;

    // Check if pharmacist has a clinic assignment that overlaps with this time slot
    const clinicAssignment = rotaAssignments.find(a =>
      a.type === "clinic" &&
      a.date === date &&
      a.pharmacistId === pharmacistId &&
      a.startTime < timeSlot.end &&
      a.endTime > timeSlot.start
    );

    if (clinicAssignment) return true;

    // Check if pharmacist has a dispensary assignment that overlaps with this time slot
    const dispensaryAssignment = rotaAssignments.find(a =>
      a.type === "dispensary" &&
      a.date === date &&
      a.pharmacistId === pharmacistId &&
      a.startTime < timeSlot.end &&
      a.endTime > timeSlot.start
    );

    return !!dispensaryAssignment;
  }

  // Helper: get pharmacist cell color
  function getPharmacistCellClass(pharmacistId: string) {
    const p = pharmacists.find((p: any) => p._id === pharmacistId);
    if (!p) return '';
    switch (p.band) {
      case 'Dispensary Pharmacist':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'EAU Practitioner':
        return 'bg-blue-900 text-white border-blue-900';
      case '8a':
        return 'bg-green-700 text-white';
      case '7':
        return 'bg-green-500 text-white';
      case '6':
        return 'bg-green-100 text-green-800';
      default:
        return '';
    }
  }

  // --- LOGGING: Pharmacist Working Days Initialization Effect ---
  useEffect(() => {
    if (!pharmacists || pharmacists.length === 0) return;
    console.log('[Effect] pharmacists changed:', pharmacists);
    // Only initialize if pharmacistWorkingDays is empty
    if (Object.keys(pharmacistWorkingDays).length === 0) {
      const newWorkingDays = Object.fromEntries(
        pharmacists.map((p: any) => [
          p._id,
          Array.isArray(p.workingDays) ? p.workingDays : CLINIC_DAY_LABELS,
        ])
      );
      const isDifferent =
        JSON.stringify(pharmacistWorkingDays) !== JSON.stringify(newWorkingDays);
      console.log('[Effect] pharmacistWorkingDays empty, isDifferent:', isDifferent);
      if (isDifferent) {
        console.log('[Effect] Setting pharmacistWorkingDays:', newWorkingDays);
        setPharmacistWorkingDays(newWorkingDays);
      }
    }
    // eslint-disable-next-line
  }, [pharmacists]);

  // --- LOGGING: Clinics Preselect Effect ---
  useEffect(() => {
    if (clinics.length > 0 && selectedClinicIds.length === 0) {
      // Pre-select all clinics with includeByDefaultInRota === true
      const defaultClinicIds = clinics.filter(c => c.includeByDefaultInRota).map(c => c._id);
      setSelectedClinicIds(defaultClinicIds);
    }
  }, [clinics, selectedClinicIds.length]);

  // --- LOGGING: Pharmacist Selection Effect ---
  useEffect(() => {
    if (!pharmacists || pharmacists.length === 0) return;
    console.log('[Effect] pharmacists changed (selection):', pharmacists);
    const defaultIds = pharmacists.filter((p: any) => p.isDefaultPharmacist).map((p: any) => p._id);
    setSelectedPharmacistIds((prev: Array<Id<"pharmacists">>) => {
      if (JSON.stringify(prev) !== JSON.stringify(defaultIds)) {
        return defaultIds;
      }
      return prev;
    });
  }, [pharmacists]);

  // --- LOGGING: RotaAssignments Setter ---
  function setRotaAssignmentsLogged(newAssignments: any[]) {
    console.log('[setRotaAssignments] called. New assignments:', newAssignments);
    setRotaAssignments((prev: any[]) => {
      const isDifferent = JSON.stringify(prev) !== JSON.stringify(newAssignments);
      console.log('[setRotaAssignments] prev:', prev, 'isDifferent:', isDifferent);
      return isDifferent ? newAssignments : prev;
    });
  }

  // --- LOGGING: Pharmacist Working Days Setter ---
  function setPharmacistWorkingDaysLogged(newWorkingDays: Record<string, string[]>) {
    console.log('[setPharmacistWorkingDays] called. New working days:', newWorkingDays);
    setPharmacistWorkingDays(newWorkingDays);
  }

  // --- LOGGING: handleSetPharmacistWorkingDays ---
  function handleSetPharmacistWorkingDays(pharmacistId: string, day: string, checked: boolean) {
    console.log('[handleSetPharmacistWorkingDays] pharmacistId:', pharmacistId, 'day:', day, 'checked:', checked);
    const newObj = { ...pharmacistWorkingDays };
    if (checked) {
      newObj[pharmacistId] = [...(newObj[pharmacistId] || []), day].filter((d, i, arr) => arr.indexOf(d) === i);
    } else {
      newObj[pharmacistId] = (newObj[pharmacistId] || []).filter(d => d !== day);
    }
    console.log('[handleSetPharmacistWorkingDays] result:', newObj);
    setPharmacistWorkingDaysLogged(newObj);
  }

  // --- LOGGING: RotaAssignments Population Effect ---
  useEffect(() => {
    console.log('[Effect] allRotas:', allRotas);
    console.log('[Effect] selectedMonday:', selectedMonday);
    if (!selectedMonday || !allRotas || allRotas.length === 0) return;
    console.log('[Effect] Populating rotaAssignments for week:', selectedMonday);
    // Find all rotas for the selected week
    const weekRotas = allRotas.filter((r: any) => {
      const rotaDate = new Date(r.date);
      const selectedDate = new Date(selectedMonday);
      const daysDiff = Math.floor((rotaDate.getTime() - selectedDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff >= 0 && daysDiff < 7;
    });

    // Create a map of dates to rota IDs
    const rotaMap: Record<string, Id<"rotas">> = {};
    weekRotas.forEach((rota: any) => {
      rotaMap[rota.date] = rota._id;
    });
    setRotaIdsByDate(rotaMap);

    // Set assignments
    const assignments = weekRotas.flatMap((r: any) => 
      r.assignments.map((a: any) => ({ ...a, date: r.date }))
    );
    console.log('[Effect] Setting rotaAssignments:', assignments);
    setRotaAssignmentsLogged(assignments);
  }, [selectedMonday, allRotas]);

  // --- LOGGING: Selected Monday and Rendered Dates ---
  useEffect(() => {
    if (!selectedMonday) return;
    const dates = Array.from({ length: 5 }, (v: undefined, i: number) => {
      const d = new Date(selectedMonday);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
    console.log('[RotaView] selectedMonday:', selectedMonday, 'Rendered dates:', dates);
  }, [selectedMonday]);

  // Reset singlePharmacistDispensaryDays when selectedMonday changes
  useEffect(() => {
    setSinglePharmacistDispensaryDays([]);
  }, [selectedMonday]);

  // Modified regeneration function to accept state override
  async function handleGenerateWeeklyRota(overrideSinglePharmacistDays?: string[], regenerateRota?: boolean) {
    // Prevent concurrent runs
    if (generatingWeekly) {
      console.warn('[handleGenerateWeeklyRota] Already generating, skipping concurrent call.');
      return;
    }
    if (!selectedMonday) return;

    setGeneratingWeekly(true); // Set generating flag BEFORE try block

    // Determine which state to use for the generation
    const daysToUse = overrideSinglePharmacistDays ?? singlePharmacistDispensaryDays;
    console.log('[handleGenerateWeeklyRota] Using singlePharmacistDays:', daysToUse);

    try {
      console.log(`[handleGenerateWeeklyRota] About to call Convex mutation with startDate: ${selectedMonday}, daysToUse: ${JSON.stringify(daysToUse)}`);
      await generateWeeklyRota({
        startDate: selectedMonday,
        pharmacistIds: selectedPharmacistIds,
        clinicIds: selectedClinicIds,
        pharmacistWorkingDays: pharmacistWorkingDays,
        singlePharmacistDispensaryDays: daysToUse, // Pass the determined state
        regenerateRota: regenerateRota, // Pass the regenerateRota flag
      });
      console.log(`[handleGenerateWeeklyRota] Convex mutation call finished for startDate: ${selectedMonday}`);
    } finally {
      setGeneratingWeekly(false);
      setRotaGenerated(true);
      console.log(`[handleGenerateWeeklyRota] finally block executed for startDate: ${selectedMonday}`);
    }
  }

  console.log('Rendering rotaAssignments', rotaAssignments);

  // Sort clinics by dayOfWeek and startTime for display
  const sortedSelectedClinics = clinics
    .filter((c: any) => selectedClinicIds.includes(c._id))
    .sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime));

  // Add helper to get the assignment index within the rota
  const getAssignmentIndexInRota = (assignment: any) => {
    const assignmentDate = new Date(assignment.date).toISOString().split('T')[0];
    const rotaId = rotaIdsByDate[assignmentDate];
    if (!rotaId) return { rotaId: null, indices: [] };

    const rota = allRotas.find((r: any) => r._id === rotaId);
    if (!rota) return { rotaId: null, indices: [] };

    // For dispensary assignments, find all slots for the same pharmacist in that time range
    if (assignment.location === "Dispensary") {
      const indices = rota.assignments
        .map((a: any, idx: number) => ({ ...a, idx }))
        .filter((a: any) => 
          a.location === "Dispensary" && 
          a.pharmacistId === assignment.pharmacistId
        )
        .map((a: any) => a.idx);
      return { rotaId, indices };
    }

    // For other assignments, just find the exact match
    const index = rota.assignments.findIndex((a: any) => 
      a.location === assignment.location && 
      a.start === assignment.start && 
      a.end === assignment.end
    );

    return { rotaId, indices: index !== -1 ? [index] : [] };
  };

  // Add helper to get assignments for scope
  const getAssignmentsForScope = (
    location: string, 
    date: string, 
    scope: "slot" | "day" | "week",
    startTime?: string,
    endTime?: string
  ): { rotaId: Id<"rotas">, indices: number[] }[] => {
    console.log(`[getAssignmentsForScope] Called with scope: ${scope}, location: ${location}, date: ${date}, startTime: ${startTime}, endTime: ${endTime}`);
    const results: { rotaId: Id<"rotas">, indices: number[] }[] = [];
    
    // Determine if this is a ward (which uses full-day assignments)
    const isWard = location.includes("Ward") || location.includes("ITU") || location.includes("Emergency Assessment Unit");
    console.log(`[getAssignmentsForScope] Location "${location}" is ${isWard ? 'a ward' : 'not a ward'}`);
    
    if (scope === "slot") {
      // For single slot, get the exact assignment
      const rotaId = rotaIdsByDate[date];
      if (!rotaId) return results;

      const rota = allRotas.find((r: any) => r._id === rotaId);
      if (!rota) return results;

      // For wards with slot scope, we need to find the full-day assignment
      // and create a new assignment for just that time slot
      if (isWard) {
        console.log(`[getAssignmentsForScope] Handling ward with slot scope - will create a new time-specific assignment`);
        // For wards, find the full-day assignment
        const indices = rota.assignments
          .map((a: any, idx: number) => ({ ...a, idx }))
          .filter((a: any) => 
            a.location === location && 
            a.startTime === "00:00" && 
            a.endTime === "23:59"
          )
          .map((a: any) => a.idx);
        
        console.log(`[getAssignmentsForScope] Found ward full-day assignment indices: ${indices.join(', ')}`);
        if (indices.length > 0) {
          results.push({ rotaId, indices });
        }
      } else {
        // For non-wards (dispensary, clinics), find the exact time slot
        // Ensure startTime and endTime are provided for slot scope
        if (!startTime || !endTime) {
          console.error("[getAssignmentsForScope] StartTime or EndTime missing for 'slot' scope.");
          return results;
        }

        const indices = rota.assignments
          .map((a: any, idx: number) => ({ ...a, idx }))
          .filter((a: any) => 
            a.location === location && 
            a.startTime === startTime && // Strict check
            a.endTime === endTime     // Strict check
          )
          .map((a: any) => a.idx);
          
        console.log(`[getAssignmentsForScope] Scope: slot, Found indices: ${indices.join(', ')} for rota ${rotaId}`);
        if (indices.length > 0) {
          results.push({ rotaId, indices });
        }
      }
    } else if (scope === "day") {
      // For day, get all assignments for this location on this date
      const rotaId = rotaIdsByDate[date];
      if (!rotaId) return results;

      const rota = allRotas.find((r: any) => r._id === rotaId);
      if (!rota) return results;

      const indices = rota.assignments
        .map((a: any, idx: number) => ({ ...a, idx }))
        .filter((a: any) => a.location === location) // Match location only
        .map((a: any) => a.idx);

      console.log(`[getAssignmentsForScope] Scope: day, Found indices: ${indices.join(', ')} for rota ${rotaId}`);
      if (indices.length > 0) {
        results.push({ rotaId, indices });
      }
    } else { // week scope
      // For week, get all assignments for this location across all rotas
      console.log(`[getAssignmentsForScope] Scope: week, Checking all rotas for location: ${location}`);
      Object.entries(rotaIdsByDate).forEach(([currentDate, rotaId]) => {
        const rota = allRotas.find((r: any) => r._id === rotaId);
        if (!rota) return;

        const indices = rota.assignments
          .map((a: any, idx: number) => ({ ...a, idx }))
          .filter((a: any) => a.location === location) // Match location only
          .map((a: any) => a.idx);

        if (indices.length > 0) {
          console.log(`[getAssignmentsForScope] Scope: week, Found indices: ${indices.join(', ')} for rota ${rotaId} on date ${currentDate}`);
          results.push({ rotaId, indices });
        }
      });
    }

    console.log('[getAssignmentsForScope] Returning results:', JSON.stringify(results));
    return results;
  };

  // Add helper to determine the assignment to display in a specific cell
  const getAssignmentForCell = (
    location: string,
    date: string,
    slotStartTime: string,
    slotEndTime: string,
    allAssignmentsForDate: any[] // Pass the relevant rota.assignments array for the specific date
  ): any | null => {
    // 1. Check for exact slot match
    const specificAssignment = allAssignmentsForDate.find(a =>
      a.location === location &&
      a.startTime === slotStartTime &&
      a.endTime === slotEndTime
    );

    if (specificAssignment) {
      return specificAssignment;
    }

    // 2. Check if it's a ward
    const isWard = location.includes("Ward") || location.includes("ITU") || location.includes("Emergency Assessment Unit");

    // 3. If it's a ward and no specific assignment found, check for full-day
    if (isWard) {
      const fullDayAssignment = allAssignmentsForDate.find(a =>
        a.location === location &&
        a.startTime === '00:00' &&
        a.endTime === '23:59'
      );
      if (fullDayAssignment) {
        return fullDayAssignment;
      }
    }

    // 4. No specific or relevant full-day assignment found
    return null;
  };

  // Add handler for empty cell click
  const handleEmptyCellClick = (location: string, type: "ward" | "dispensary" | "clinic" | "management", date: string, start: string, end: string) => {
    const assignmentDate = new Date(date).toISOString().split('T')[0];
    const rotaId = rotaIdsByDate[assignmentDate];
    if (!rotaId) {
      console.error('No rota found for date:', assignmentDate);
      return;
    }

    setSelectedCell({ 
      rotaId, 
      assignmentIndices: [], 
      currentPharmacistId: null,
      location,
      date: assignmentDate,
      startTime: start,
      endTime: end,
      newAssignment: {
        location,
        type,
        startTime: start,
        endTime: end
      }
    });
    setShowPharmacistSelection(true);
  };

  // Add handler for cell click
  const handleCellClick = (
    assignment: any, 
    currentPharmacistId: Id<"pharmacists">,
    cellStartTime: string, 
    cellEndTime: string
  ) => {
    const assignmentDate = new Date(assignment.date).toISOString().split('T')[0];
    const rotaId = rotaIdsByDate[assignmentDate];
    if (!rotaId) {
      console.error('No rota found for date:', assignmentDate);
      return;
    }

    // Find the assignment index
    const rota = allRotas.find((r: any) => r._id === rotaId);
    if (!rota) return;

    const assignmentIndex = rota.assignments.findIndex((a: any) => 
      a.location === assignment.location && 
      a.startTime === assignment.startTime && 
      a.endTime === assignment.endTime &&
      a.pharmacistId === currentPharmacistId
    );

    if (assignmentIndex === -1) {
      console.error('Could not find assignment in rota');
      return;
    }

    setSelectedCell({ 
      rotaId,
      assignmentIndices: [assignmentIndex],
      currentPharmacistId,
      location: assignment.location,
      date: assignmentDate,
      startTime: cellStartTime,
      endTime: cellEndTime
    });
    setShowPharmacistSelection(true);
  };

  // Update handler for pharmacist selection
  const handlePharmacistSelect = async (pharmacistId: Id<"pharmacists">, scope: "slot" | "day" | "week") => {
    if (!selectedCell) return;
    const newAssignment = selectedCell.newAssignment;
    console.log(`[handlePharmacistSelect] Started. Scope: ${scope}, PharmacistID: ${pharmacistId}, Location: ${selectedCell.location}, Date: ${selectedCell.date}, Start: ${selectedCell.startTime}, End: ${selectedCell.endTime}`);

    try {
      // Determine if this is a ward (which uses full-day assignments)
      const isWard = selectedCell.location.includes("Ward") || 
                    selectedCell.location.includes("ITU") || 
                    selectedCell.location.includes("Emergency Assessment Unit");

      if (newAssignment) {
        console.log("[handlePharmacistSelect] Handling new assignment creation.");
        // For new assignments, create a new slot
        await updateAssignment({
          rotaId: selectedCell.rotaId,
          assignmentIndex: -1,
          pharmacistId,
          newAssignment
        });
        console.log("[handlePharmacistSelect] Initial new assignment created.");

        // If scope is day or week, create additional slots
        if (scope !== "slot") {
          console.log(`[handlePharmacistSelect] Creating additional slots for scope: ${scope}`);
          const timeSlots = TIME_SLOTS.map(slot => ({
            startTime: slot.start,
            endTime: slot.end
          })).filter(slot => 
            // Don't duplicate the slot we just created
            slot.startTime !== newAssignment.startTime ||
            slot.endTime !== newAssignment.endTime
          );

          // For week scope, get all dates
          const dates = scope === "week" 
            ? Object.keys(rotaIdsByDate)
            : [selectedCell.date];

          // Create assignments for each time slot and date
          for (const date of dates) {
            const rotaId = rotaIdsByDate[date];
            if (!rotaId) continue;

            for (const slot of timeSlots) {
              await updateAssignment({
                rotaId,
                assignmentIndex: -1,
                pharmacistId,
                newAssignment: {
                  location: newAssignment.location,
                  type: newAssignment.type,
                  startTime: slot.startTime,
                  endTime: slot.endTime
                }
              });
            }
          }
          console.log(`[handlePharmacistSelect] Finished creating additional slots for scope: ${scope}`);
        }
      } else {
        console.log("[handlePharmacistSelect] Handling existing assignment update.");
        
        // Special handling for ward assignments with slot scope
        if (isWard && scope === "slot" && selectedCell.startTime && selectedCell.endTime) {
          console.log("[handlePharmacistSelect] Special handling for ward with slot scope");
          
          // For wards with slot scope, we'll create a new time-specific assignment
          // while keeping the original full-day assignment
          await updateAssignment({
            rotaId: selectedCell.rotaId,
            assignmentIndex: -1, // Create new
            pharmacistId,
            newAssignment: {
              location: selectedCell.location,
              type: "ward",
              startTime: selectedCell.startTime,
              endTime: selectedCell.endTime
            }
          });
          
          console.log("[handlePharmacistSelect] Created time-specific ward assignment");
        } else {
          // For all other cases, get assignments based on scope
          const assignmentsToUpdate = getAssignmentsForScope(
            selectedCell.location, 
            selectedCell.date, 
            scope,
            selectedCell.startTime,
            selectedCell.endTime
          );
          
          console.log(`[handlePharmacistSelect] Assignments found by getAssignmentsForScope for scope '${scope}':`, JSON.stringify(assignmentsToUpdate));

          if (assignmentsToUpdate.length === 0) {
             console.warn("[handlePharmacistSelect] No assignments found to update for the selected scope and details.");
          }

          // Update each assignment
          for (const { rotaId, indices } of assignmentsToUpdate) {
             console.log(`[handlePharmacistSelect] Processing Rota ID: ${rotaId}, Indices: ${indices.join(', ')}`);
             for (const index of indices) {
              console.log(`[handlePharmacistSelect] -> Calling updateAssignment for Rota ID: ${rotaId}, Index: ${index}`);
              await updateAssignment({
                rotaId,
                assignmentIndex: index,
                pharmacistId
              });
            }
          }
        }
        console.log("[handlePharmacistSelect] Finished updating existing assignments.");
      }

      // Refresh assignments - Let's keep this for now, but be aware it might cause visual glitches if Convex reactivity is faster/slower
       console.log("[handlePharmacistSelect] Refreshing local rotaAssignments state.");
       const refreshedAssignments = allRotas.flatMap((r: any) => 
         r.assignments.map((a: any) => ({ ...a, date: r.date }))
       );
       setRotaAssignments(refreshedAssignments); // Assuming setRotaAssignments is the correct setter
       console.log("[handlePharmacistSelect] Local state refreshed.");

    } catch (error) {
      console.error('[handlePharmacistSelect] Failed to update assignment:', error);
    } finally {
       // Always close the modal and clear selection
       setSelectedCell(null);
       setShowPharmacistSelection(false);
       console.log("[handlePharmacistSelect] Modal closed and selection cleared.");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-4 mt-6">
        <div>
          <label className="block font-medium mb-1">Select Monday (week start)</label>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={selectedMonday}
            onChange={e => setSelectedMonday(e.target.value)}
            min="2024-01-01"
            step="7"
          />
        </div>
        <button
          className="bg-blue-600 text-white px-3 py-2 rounded mt-6 disabled:opacity-50"
          disabled={!selectedMonday || generatingWeekly}
          onClick={() => {
            setShowClinicSelection(true);
            setRotaGenerated(false);
          }}
        >
          Create Rota
        </button>
      </div>
      {showClinicSelection && !rotaGenerated && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Select Clinics to Include in Rota</h3>
          <div className="flex flex-wrap gap-4">
            {clinics.slice().sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime)).map((clinic: any) => (
              <label key={clinic._id} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={selectedClinicIds.includes(clinic._id)}
                  onChange={e => {
                    setSelectedClinicIds((ids: Array<Id<"clinics">>) =>
                      e.target.checked
                        ? [...ids, clinic._id]
                        : ids.filter(id => id !== clinic._id)
                    );
                  }}
                />
                <span>{clinic.name} ({CLINIC_DAY_LABELS[clinic.dayOfWeek-1]} {clinic.startTime}-{clinic.endTime})</span>
              </label>
            ))}
          </div>
          <button
            className="mt-4 bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedClinicIds.length === 0}
            onClick={() => {
              setShowClinicSelection(false);
              setShowPharmacistSelection(true);
            }}
          >
            Confirm Clinics
          </button>
        </div>
      )}
      {showPharmacistSelection && !rotaGenerated && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Select Pharmacists and Working Days</h3>
          <div className="flex flex-col gap-2">
            {[...pharmacists.filter((p: any) => p.isDefaultPharmacist),
              ...pharmacists.filter((p: any) =>
                !p.isDefaultPharmacist && selectedPharmacistIds.includes(p._id)
              ),
            ]
              .sort((a: any, b: any) => a.name.localeCompare(b.name))
              .map((pharmacist: any) => (
                <div key={pharmacist._id} className="border rounded p-2 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPharmacistIds.includes(pharmacist._id)}
                      onChange={e => {
                        setSelectedPharmacistIds((ids: Array<Id<"pharmacists">>) => {
                          const checked = e.target.checked;
                          if (checked && !ids.includes(pharmacist._id)) {
                            if (!pharmacistWorkingDays[pharmacist._id]) {
                              const newObj = { ...pharmacistWorkingDays };
                              newObj[pharmacist._id] = Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : CLINIC_DAY_LABELS;
                              setPharmacistWorkingDaysLogged(newObj);
                            }
                            return [...ids, pharmacist._id];
                          }
                          if (!checked) {
                            const newObj = { ...pharmacistWorkingDays };
                            delete newObj[pharmacist._id];
                            setPharmacistWorkingDaysLogged(newObj);
                            return ids.filter(id => id !== pharmacist._id);
                          }
                          return ids;
                        });
                      }}
                    />
                    <span className="font-medium">{pharmacist.name}</span>
                    {pharmacist.isDefaultPharmacist && (
                      <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Default</span>
                    )}
                  </div>
                  {selectedPharmacistIds.includes(pharmacist._id) && (
                    <div className="flex flex-wrap gap-4 mt-2 md:mt-0 items-center">
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-xs whitespace-nowrap mr-1">Working Days:</span>
                        {CLINIC_DAY_LABELS.map((day: string) => (
                          <label key={day} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={pharmacistWorkingDays[pharmacist._id]?.includes(day) || false}
                              onChange={e => {
                                handleSetPharmacistWorkingDays(pharmacist._id, day, e.target.checked);
                              }}
                            />
                            <span className="text-xs">{day}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="font-semibold text-xs whitespace-nowrap">Protected Rota Time:</span>
                        <ul className="flex gap-2 mb-0">
                          {getAllUnavailableRules(pharmacist).map((rule, idx) => (
                            <li key={idx} className="flex items-center gap-1 text-xs bg-red-50 rounded px-1">
                              <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                              <button
                                type="button"
                                className="text-red-500 text-xs ml-1"
                                onClick={() => {
                                  if (idx < (pharmacist.notAvailableRules?.length || 0)) {
                                    const updated = [...(pharmacist.notAvailableRules || [])];
                                    updated.splice(idx, 1);
                                    setRotaUnavailableRules(prev => ({
                                      ...prev,
                                      [pharmacist._id]: [
                                        ...((prev[pharmacist._id] || [])),
                                        ...updated.filter((_, i) => i !== idx)
                                      ]
                                    }));
                                    pharmacist.notAvailableRules.splice(idx, 1);
                                  } else {
                                    removeRotaUnavailableRule(pharmacist._id, idx - (pharmacist.notAvailableRules?.length || 0));
                                  }
                                }}
                              >✕</button>
                            </li>
                          ))}
                        </ul>
                        <select className="border rounded text-xs" id={`unavail-day-${pharmacist._id}`}>{CLINIC_DAY_LABELS.map(day => <option key={day} value={day}>{day}</option>)}</select>
                        <input className="border rounded text-xs w-20" id={`unavail-start-${pharmacist._id}`} type="time" defaultValue="09:00" />
                        <input className="border rounded text-xs w-20" id={`unavail-end-${pharmacist._id}`} type="time" defaultValue="17:00" />
                        <button type="button" className="text-blue-600 text-xs border px-1 rounded" onClick={() => {
                          const day = (document.getElementById(`unavail-day-${pharmacist._id}`) as HTMLSelectElement).value;
                          const start = (document.getElementById(`unavail-start-${pharmacist._id}`) as HTMLInputElement).value;
                          const end = (document.getElementById(`unavail-end-${pharmacist._id}`) as HTMLInputElement).value;
                          addRotaUnavailableRule(pharmacist._id, { dayOfWeek: day, startTime: start, endTime: end });
                        }}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            {/* Pharmacist search bar for non-defaults */}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search non-default pharmacists..."
                className="border rounded px-2 py-1 w-64"
                value={pharmacistSearch}
                onChange={e => setPharmacistSearch(e.target.value)}
              />
            </div>
            {/* Non-default pharmacists, only show if search is active and not selected */}
            {pharmacistSearch && (
              <div className="border rounded p-4 mb-4 bg-gray-50">
                <h4 className="font-medium mb-2">Search Results</h4>
                {[...pharmacists]
                  .filter((p: any) => !p.isDefaultPharmacist &&
                    !selectedPharmacistIds.includes(p._id) &&
                    p.name.toLowerCase().includes(pharmacistSearch.toLowerCase())
                  )
                  .sort((a: any, b: any) => a.name.localeCompare(b.name))
                  .map((pharmacist: any) => {
                    // Prepare temporary working days state for this pharmacist
                    const tempWorkingDays = pharmacistWorkingDays[pharmacist._id] || 
                      (Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : CLINIC_DAY_LABELS);
                    
                    return (
                      <div key={pharmacist._id} className="border rounded p-2 mb-2 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium">{pharmacist.name}</span>
                          <span className="text-sm text-gray-500">Band {pharmacist.band}</span>
                          {pharmacist.primaryDirectorate && (
                            <span className="text-sm bg-gray-100 px-1 py-0.5 rounded">
                              {pharmacist.primaryDirectorate}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center mb-2">
                          <span className="text-sm font-medium">Available on:</span>
                          {CLINIC_DAY_LABELS.map((day: string) => {
                            const isSelected = tempWorkingDays.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                className={`text-xs px-2 py-1 rounded-full transition-colors ${
                                  isSelected 
                                    ? "bg-green-100 text-green-800 border border-green-300" 
                                    : "bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200"
                                }`}
                                onClick={() => {
                                  // Create a temporary working days state for this pharmacist
                                  const newObj = { ...pharmacistWorkingDays };
                                  if (!newObj[pharmacist._id]) {
                                    newObj[pharmacist._id] = [...tempWorkingDays];
                                  }
                                  
                                  if (isSelected) {
                                    // Remove day if already selected
                                    newObj[pharmacist._id] = newObj[pharmacist._id].filter(d => d !== day);
                                  } else {
                                    // Add day if not selected
                                    newObj[pharmacist._id] = [...newObj[pharmacist._id], day];
                                  }
                                  
                                  setPharmacistWorkingDaysLogged(newObj);
                                }}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700"
                            onClick={() => {
                              setSelectedPharmacistIds(ids => [...ids, pharmacist._id]);
                              setPharmacistSearch(''); // Clear search after adding
                            }}
                          >
                            Add to Rota
                          </button>
                        </div>
                      </div>
                    );
                  })}
                {[...pharmacists]
                  .filter((p: any) => !p.isDefaultPharmacist &&
                    !selectedPharmacistIds.includes(p._id) &&
                    p.name.toLowerCase().includes(pharmacistSearch.toLowerCase())
                  ).length === 0 && (
                  <div className="text-gray-500 italic">No matching pharmacists found</div>
                )}
              </div>
            )}
          </div>
          <button
            className="mt-4 bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedPharmacistIds.length === 0}
            onClick={() => {
              setShowPharmacistSelection(false);
              handleGenerateWeeklyRota();
            }}
          >
            Confirm Pharmacists
          </button>
        </div>
      )}
      {rotaGenerated && (
        <div className="mt-10">
          <h3 className="text-xl font-bold mb-4">Weekly Rota Table</h3>
          
          {/* Dispensary Mode Toggles */}
          <div className="mb-4">
            {[0,1,2,3,4].map((dayOffset: number) => {
              const date = new Date(selectedMonday);
              date.setDate(date.getDate() + dayOffset);
              const isoDate = date.toISOString().split('T')[0];
              
              // Check if this day has a dispensary pharmacist
              const hasDispensaryPharmacist = pharmacists.some(p => {
                return p.band === "Dispensary Pharmacist" && 
                       selectedPharmacistIds.includes(p._id) && // Only consider selected pharmacists
                       // Check if they work on this day (either no working days specified or this day is included)
                       (pharmacistWorkingDays[p._id]?.includes(DAYS[date.getDay()]) || 
                          (!pharmacistWorkingDays[p._id] && p.workingDays?.includes(DAYS[date.getDay()]))) &&
                       // And they don't have unavailable rules that conflict with the whole day
                       (!getAllUnavailableRules(p).some(rule => 
                          rule.dayOfWeek === DAYS[date.getDay()] &&
                          !(rule.endTime <= "09:00" || rule.startTime >= "17:00")
                       ));
              });
              
              // Only show toggle for days without dispensary pharmacist
              if (!hasDispensaryPharmacist) {
                return (
                  <div key={isoDate} className="flex items-center gap-2 mb-2">
                    <label className="flex items-center cursor-pointer">
                      <div className="mr-2 text-sm font-medium">
                        {DAYS[date.getDay()]} ({date.toLocaleDateString()}): 
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={singlePharmacistDispensaryDays.includes(isoDate)}
                          onChange={e => {
                            const isChecked = e.target.checked;
                            let nextState: string[];
                            // Calculate the next state *before* setting it
                            if (isChecked) {
                               nextState = [...singlePharmacistDispensaryDays, isoDate];
                            } else {
                               nextState = singlePharmacistDispensaryDays.filter(d => d !== isoDate);
                            }
                            // Set the state
                            setSinglePharmacistDispensaryDays(nextState);
                            // Immediately call regeneration with the calculated next state
                            handleGenerateWeeklyRota(nextState, true);
                          }}
                        />
                        <div className={`w-10 h-5 bg-gray-200 rounded-full shadow-inner transition-colors ${singlePharmacistDispensaryDays.includes(isoDate) ? 'bg-blue-500' : ''}`}></div>
                        <div className={`absolute w-4 h-4 bg-white rounded-full shadow top-0.5 left-0.5 transition ${singlePharmacistDispensaryDays.includes(isoDate) ? 'transform translate-x-5' : ''}`}></div>
                      </div>
                      <div className="ml-2 text-sm text-gray-700">
                        {singlePharmacistDispensaryDays.includes(isoDate) 
                          ? "Single pharmacist all day" 
                          : "Multiple pharmacists (2-hour slots)"}
                      </div>
                    </label>
                  </div>
                );
              }
              return null;
            })}
          </div>
          
          <div className="overflow-x-auto w-full max-w-full">
            <table className="border text-xs md:text-sm table-fixed w-full">
              <colgroup>
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                {[...Array(5 * TIME_SLOTS.length)].map((_, idx) => (
                  <col key={idx} style={{ width: '70px' }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="border p-2 bg-gray-100 sticky left-0 z-10 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>Directorate</th>
                  <th className="border p-2 bg-gray-100 sticky left-0 z-10 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>Ward</th>
                  {[0,1,2,3,4].map((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    return (
                      <th key={dayOffset} colSpan={TIME_SLOTS.length} className="border p-2 bg-gray-100 text-xs border-r-4 border-gray-400 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>
                        {DAYS[date.getDay()]}<br/>{date.toLocaleDateString()}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="border p-2 sticky left-0 bg-white z-10 border-b border-gray-200" colSpan={2} style={{ borderBottomWidth: 1 }}></th>
                  {[...Array(5)].flatMap((_, dayIdx: number) =>
                    TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => (
                      <th key={dayIdx + '-' + slot.start + '-' + slot.end}
                        className={`border p-2 bg-blue-50 text-xs${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`}
                        style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}
                      >
                        {slot.start}-{slot.end}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {allWards.flatMap((ward: any, idx: number, arr: any[]) => {
                  // Check if this is the last ward in a directorate
                  const isLastInDirectorate = idx < arr.length - 1 && ward.directorate !== arr[idx + 1].directorate;
                  
                  if (ward.directorate === "EAU") {
                    const todayDates = [...Array(5)].map((_, dayOffset) => {
                      const d = new Date(selectedMonday);
                      d.setDate(d.getDate() + dayOffset);
                      return d.toISOString().split('T')[0];
                    });
                    let maxRows = 0;
                    todayDates.forEach(date => {
                      TIME_SLOTS.forEach(slot => {
                        const list = rotaAssignments.filter(a =>
                          a.type === "ward" &&
                          a.date === date &&
                          a.location === ward.name &&
                          a.startTime <= slot.start &&
                          a.endTime >= slot.end
                        );
                        if (list.length > maxRows) maxRows = list.length;
                      });
                    });
                    return Array.from({ length: maxRows }, (_, rowIdx) => {
                      // Apply directorate separator style to the last row
                      const isLastRow = rowIdx === maxRows - 1;
                      const applyDirectorateSeparator = isLastRow && isLastInDirectorate;
                      const rowStyle = applyDirectorateSeparator ? { borderBottom: '4px solid #9ca3af' } : { borderBottom: '1px solid #e5e7eb' };
                      
                      return (
                        <tr key={`${ward.name}_row_${rowIdx}`} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                          <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{rowIdx === 0 ? ward.directorate : ''}</td>
                          <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{rowIdx === 0 ? ward.name : ''}</td>
                          {todayDates.flatMap((isoDate, dayOffset) =>
                            TIME_SLOTS.map((slot, slotIdx) => {
                              // Get assignments specifically for this date
                              const assignmentsForDate = rotaAssignments.filter(a => a.date === isoDate);
                              // Determine the assignment to display in this cell
                              const cellAssignment = getAssignmentForCell(ward.name, isoDate, slot.start, slot.end, assignmentsForDate);
                              // Find the assignment matching the specific row index if multiple pharmacists assigned (legacy check?)
                              // This part might need review if the underlying data structure changes
                              const assignmentToShow = assignmentsForDate.filter(a => 
                                  a.type === "ward" && 
                                  a.location === ward.name && 
                                  a.startTime <= slot.start && 
                                  a.endTime >= slot.end
                              )[rowIdx];
                              // Use cellAssignment determined by the new logic, but fall back to assignmentToShow maybe?
                              // Let's prioritize cellAssignment for now.
                              const displayAssignment = assignmentToShow || cellAssignment; // Or potentially assignmentToShow if cellAssignment logic misses multi-row cases?
                              
                              return (
                                <td
                                  key={isoDate + slot.start + slot.end + ward.name + rowIdx}
                                  className={`border p-1 text-center truncate max-w-[70px] text-xs align-middle whitespace-normal${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${displayAssignment ? getPharmacistCellClass(displayAssignment.pharmacistId) : 'cursor-pointer hover:bg-gray-100'}`}
                                  style={{ ...rowStyle, borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                                  onClick={() => displayAssignment ? handleCellClick(displayAssignment, displayAssignment.pharmacistId, slot.start, slot.end) : handleEmptyCellClick(ward.name, "ward", isoDate, slot.start, slot.end)}
                                >
                                  {displayAssignment ? (
                                    <span className={hasOverlappingAssignments(displayAssignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}>
                                      {getPharmacistName(displayAssignment.pharmacistId)}
                                    </span>
                                  ) : ''}
                                </td>
                              );
                            })
                          )}
                        </tr>
                      );
                    });
                  }

                  // Apply directorate separator style
                  const rowStyle = isLastInDirectorate ? { borderBottom: '4px solid #9ca3af' } : { borderBottom: '1px solid #e5e7eb' };
                  
                  return [
                    <tr key={ward.directorate + ward.name} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                      <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{ward.directorate}</td>
                      <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{ward.name}</td>
                      {[...Array(5)].flatMap((_, dayOffset: number) => {
                        const date = new Date(selectedMonday);
                        date.setDate(date.getDate() + dayOffset);
                        const isoDate = date.toISOString().split('T')[0];
                        return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                          // Get assignments specifically for this date
                          const assignmentsForDate = rotaAssignments.filter(a => a.date === isoDate);
                          // Determine the assignment to display in this cell using the new logic
                          const displayAssignment = getAssignmentForCell(ward.name, isoDate, slot.start, slot.end, assignmentsForDate);
                          // Note: The rowIdx logic for multiple assignments per slot is currently bypassed
                          // by prioritizing the result from getAssignmentForCell.

                          return (
                            <td
                              key={isoDate + slot.start + slot.end + ward.name}
                              className={`border p-1 text-center truncate max-w-[70px] text-xs align-middle whitespace-normal${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${displayAssignment ? getPharmacistCellClass(displayAssignment.pharmacistId) : 'cursor-pointer hover:bg-gray-100'}`}
                              style={{ ...rowStyle, borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                              // Use displayAssignment for the click handler, passing the specific slot times
                              onClick={() => displayAssignment ? handleCellClick(displayAssignment, displayAssignment.pharmacistId, slot.start, slot.end) : handleEmptyCellClick(ward.name, "ward", isoDate, slot.start, slot.end)}
                            >
                              {displayAssignment ? (
                                // Display name based on the found assignment
                                <span className={hasOverlappingAssignments(displayAssignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}>
                                  {getPharmacistName(displayAssignment.pharmacistId)}
                                </span>
                              ) : ''}
                            </td>
                          );
                        })
                      })}
                    </tr>
                  ];
                })}
                <tr>
                  <td colSpan={2} className="border p-2 font-semibold bg-red-50 text-red-700 sticky left-0 z-10" style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb' }}>Unavailable</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      // For this slot, get pharmacists unavailable at this day/slot
                      const unavailable = pharmacists.filter((p: any) => {
                        if (!p.notAvailableRules || !Array.isArray(p.notAvailableRules)) return false;
                        return p.notAvailableRules.some((rule: any) =>
                          rule.dayOfWeek === DAYS[date.getDay()] &&
                          !(rule.endTime <= slot.start || rule.startTime >= slot.end)
                        );
                      });
                      return (
                        <td key={dayOffset + '-' + slotIdx} className="border p-1 text-xs bg-red-50 text-red-700 text-center" style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}>
                          {unavailable.map((p: any) => p.name).join(', ') || ''}
                        </td>
                      );
                    });
                  })}
                </tr>
                {/* --- Dispensary --- */}
                <tr>
                  <td className="border p-2 font-semibold sticky left-0 bg-white z-10" colSpan={2} style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb' }}>Dispensary</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      const assignment = getDispensaryAssignment(isoDate, slot);
                      let displayName = '';
                      let isLunch = false;
                      if (assignment) {
                        displayName = getPharmacistName(assignment.pharmacistId);
                        if (assignment.isLunchCover && slot.start === '13:30' && slot.end === '14:00') {
                          isLunch = true;
                        }
                      }
                      return (
                        <td
                          key={dayOffset + '-' + slotIdx}
                          className={`border p-1 text-xs bg-gray-50 font-semibold${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${assignment ? getPharmacistCellClass(assignment.pharmacistId) : 'cursor-pointer hover:bg-gray-100'}`}
                          style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                          onClick={() => assignment ? handleCellClick(assignment, assignment.pharmacistId, slot.start, slot.end) : handleEmptyCellClick("Dispensary", "dispensary", isoDate, slot.start, slot.end)}
                        >
                          {displayName && (
                            isLunch ? (
                              <span>
                                <span className={assignment && hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}>
                                  {displayName}
                                </span>
                                <br />
                                <span style={{ fontWeight: 400 }}>(Lunch)</span>
                              </span>
                            ) : (
                              <span className={assignment && hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : 'text-black font-bold'}>
                                {displayName}
                              </span>
                            )
                          )}
                        </td>
                      );
                    });
                  })}
                </tr>
                {sortedSelectedClinics.map((clinic: any, idx: number) => {
                  // Highlight all slots that overlap with the clinic's time range
                  // Add '(Warfarin Clinic)' after the clinic code in the far left column
                  const clinicLabel = `${clinic.name} (Warfarin Clinic)`;
                  // Determine if this is the first clinic
                  const isFirstClinic = idx === 0;
                  // Determine if this is the last clinic
                  const isLastClinic = idx === sortedSelectedClinics.length - 1;
                  const rowStyle = {
                    borderTop: isFirstClinic ? '4px solid #9ca3af' : '1px solid #e5e7eb',
                    borderBottom: isLastClinic ? '4px solid #9ca3af' : '1px solid #e5e7eb'
                  };
                  
                  return (
                    <tr key={clinic._id}>
                      <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{clinicLabel}</td>
                      <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{clinic.name}</td>
                      {[...Array(5)].flatMap((_, dayOffset: number) => {
                        const date = new Date(selectedMonday);
                        date.setDate(date.getDate() + dayOffset);
                        const isoDate = date.toISOString().split('T')[0];
                        return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                          const isClinicDay = (dayOffset + 1) === clinic.dayOfWeek;
                          // Highlight if slot overlaps with clinic time (inclusive start, exclusive end)
                          const slotStart = slot.start;
                          const slotEnd = slot.end;
                          const overlaps =
                            slotStart < clinic.endTime && slotEnd > clinic.startTime;
                          if (isClinicDay && overlaps) {
                            // Get clinic assignment for this date
                            const assignment = getClinicAssignment(isoDate, clinic.name);
                            return (
                              <td
                                key={isoDate + slot.start + slot.end + clinic._id}
                                className={`border p-1 text-center truncate max-w-[70px] text-xs bg-yellow-100 font-semibold${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`}
                                style={{ 
                                  ...rowStyle,
                                  borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined,
                                  backgroundColor: assignment ? '#fef9c3' : '#fef9c3', // Maintain yellow background
                                  color: '#000' // Always black text for clinics
                                }}
                                onClick={() => assignment && handleCellClick(assignment, assignment.pharmacistId, slot.start, slot.end)}
                              >
                                {assignment ? (
                                  <span className={hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : 'text-black font-bold'}>
                                    {getPharmacistName(assignment.pharmacistId)}
                                  </span>
                                ) : ""}
                              </td>
                            );
                          } else {
                            return <td key={isoDate + slot.start + slot.end + clinic._id} className={`border p-1 text-center max-w-[70px] text-xs bg-gray-50${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`} style={{ ...rowStyle, borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}></td>;
                          }
                        });
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {/* --- Unavailable Pharmacists Row --- */}
              <tfoot>
                <tr>
                  <td colSpan={2} className="border p-2 font-semibold bg-red-50 text-red-700 sticky left-0 z-10" style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb' }}>Unavailable</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      // For this slot, get pharmacists unavailable at this day/slot
                      const unavailable = pharmacists.filter((p: any) => {
                        if (!p.notAvailableRules || !Array.isArray(p.notAvailableRules)) return false;
                        return p.notAvailableRules.some((rule: any) =>
                          rule.dayOfWeek === DAYS[date.getDay()] &&
                          !(rule.endTime <= slot.start || rule.startTime >= slot.end)
                        );
                      });
                      return (
                        <td key={dayOffset + '-' + slotIdx} className="border p-1 text-xs bg-red-50 text-red-700 text-center" style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}>
                          {unavailable.map((p: any) => p.name).join(', ') || ''}
                        </td>
                      );
                    });
                  })}
                </tr>
                {/* --- Management Time --- */}
                <tr>
                  <td colSpan={2} className="border p-2 font-semibold bg-blue-100 z-10 truncate max-w-[120px]" style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb' }}>Management Time</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      // Find Band 8a pharmacists in Management Time for this date/slot
                      const managementAssignments = rotaAssignments.filter(a => 
                        a.type === "management" && 
                        a.date === isoDate && 
                        ((a.startTime <= slot.start && a.endTime > slot.start) || 
                         (a.startTime < slot.end && a.endTime >= slot.end) ||
                         (a.startTime >= slot.start && a.endTime <= slot.end))
                      );
                      
                      // Get pharmacist names
                      const pharmacistNames = managementAssignments.map(a => getPharmacistName(a.pharmacistId)).filter(Boolean);
                      
                      return (
                        <td
                          key={isoDate + slot.start + slot.end + 'management'}
                          className={`border p-1 text-center max-w-[70px] text-xs bg-blue-50${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`} 
                          style={{ borderTop: '4px solid #9ca3af', borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                        >
                          {pharmacistNames.length > 0 ? (
                            <span>{pharmacistNames.join(", ")}</span>
                          ) : null}
                        </td>
                      );
                    });
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {/* Add the PharmacistSelectionModal */}
      {showPharmacistSelection && selectedCell && (
        <PharmacistSelectionModal
          isOpen={showPharmacistSelection}
          onClose={() => {
            setShowPharmacistSelection(false);
            setSelectedCell(null);
          }}
          onSelect={handlePharmacistSelect}
          currentPharmacistId={selectedCell.currentPharmacistId}
          location={selectedCell.location}
        />
      )}
    </div>
  );
}
