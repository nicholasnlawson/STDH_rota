import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { getBankHolidaysInRange, BankHoliday } from "./bankHolidays";
import { PharmacistSelectionModal } from "./PharmacistSelectionModal";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/* Custom CSS for Not Selected overlays */
const notSelectedStyles = `
  .not-selected-cell {
    position: relative !important;
    pointer-events: none !important;
  }
  
  .not-selected-cell > :not(.not-selected-overlay) {
    visibility: hidden !important;
  }
  
  .not-selected-overlay {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background-color: rgba(229, 231, 235, 0.95) !important;
    z-index: 10 !important;
  }
`;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLINIC_DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

interface RotaViewProps {
  isViewOnly?: boolean;
  isAdmin?: boolean;
  initialSelectedMonday?: string;
  initialRotaAssignments?: any[];
  initialRotaIdsByDate?: Record<string, Id<"rotas">>;
  publishedRota?: {
    _id: Id<"rotas">;
    date: string;
    title?: string;
    publishedBy?: {
      name: string;
      email: string;
    };
    includedWeekdays?: string[];
  } | null;
  onEditsChanged?: (edits: {
    assignments?: any[];
    freeCellText?: Record<string, string>;
  }) => void;
}

export function RotaView({
  isViewOnly = false,
  isAdmin = false,
  initialSelectedMonday = "",
  initialRotaAssignments = [],
  initialRotaIdsByDate = {},
  publishedRota = null,
  onEditsChanged
}: RotaViewProps = {}): React.ReactElement {
  // If user is not an admin and not in a specific view-only mode (like viewing published rotas),
  // set isViewOnly to true to prevent any edits
  const effectiveViewOnly = isViewOnly || !isAdmin;
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const generateWeeklyRota = useMutation(api.rotas.generateWeeklyRota);
  const updateAssignment = useMutation(api.rotas.updateRotaAssignment);
  // publishRota will be reimplemented
  const clinics = useQuery(api.clinics.listClinics) || [];
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  const [selectedClinicIds, setSelectedClinicIds] = useState<Array<Id<"clinics">>>([]);
  const [selectedPharmacistIds, setSelectedPharmacistIds] = useState<Array<Id<"pharmacists">>>(() => {
    // Preselect default pharmacists
    return (pharmacists.filter((p: any) => p.isDefaultPharmacist).map((p: any) => p._id) || []);
  });
  const [selectedMonday, setSelectedMonday] = useState(initialSelectedMonday);
  const [generatingWeekly, setGeneratingWeekly] = useState(false);
  const [showClinicSelection, setShowClinicSelection] = useState(false);
  const [showPharmacistSelection, setShowPharmacistSelection] = useState(false);
  const [rotaGenerated, setRotaGenerated] = useState(effectiveViewOnly || false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  // Track current user for tracking metadata when publishing
  const [currentUser, setCurrentUser] = useState<{name: string, email: string}>(() => {
    // Try to get user info from localStorage - use currentPharmacist which is the correct key
    const storedUser = localStorage.getItem('currentPharmacist');
    return storedUser ? JSON.parse(storedUser) : { name: 'Unknown User', email: '' };
  });
  
  // Update currentUser whenever localStorage changes
  useEffect(() => {
    const handleStorageChange = () => {
      const storedUser = localStorage.getItem('currentPharmacist');
      if (storedUser) {
        setCurrentUser(JSON.parse(storedUser));
      }
    };
    
    // Check if we need to update right away
    handleStorageChange();
    
    // Listen for changes
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  // Define all state variables needed for isDeselectedDay function upfront
  const [freeCellText, setFreeCellText] = useState<Record<string, string>>({});
  const [pharmacistWorkingDays, setPharmacistWorkingDays] = useState<Record<string, string[]>>({});
  const [selectedWeekdays, setSelectedWeekdays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [rotaIdsByDate, setRotaIdsByDate] = useState<Record<string, Id<"rotas">>>(initialRotaIdsByDate || {});
  const [rotaAssignments, setRotaAssignments] = useState<any[]>(initialRotaAssignments || []);
  
  // Query to get all rotas - with appropriate filter based on view mode
  const allRotas = useQuery(api.rotas.listRotas, { status: effectiveViewOnly ? "published" : "draft" }) || [];
  
  // State for tracking dynamically added EAU rows
  const [eauAdditionalRows, setEauAdditionalRows] = useState<number[]>([]);
  
  // Helper function to add a new EAU row
  const addEauRow = useCallback(() => {
    setEauAdditionalRows(prev => [...prev, prev.length + 2]);
  }, []);
  
  // Helper to check if a date corresponds to a deselected weekday - memoized to prevent infinite loops
  const isDeselectedDay = useCallback((date: Date): boolean => {
    try {
      const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayLabel = dayLabels[date.getDay()];
      
      // Get the date in ISO format for lookups
      const isoDate = date.toISOString().split('T')[0];
      
      // Find the corresponding rota for this date - needed in both view and edit mode
      const rotaId = rotaIdsByDate ? rotaIdsByDate[isoDate] : null;
      
      // For published rotas in edit mode, we need special handling
      if (!effectiveViewOnly && publishedRota && publishedRota._id) {
        // For dates that are within our published rota week, use the saved included weekdays
        if (publishedRota.includedWeekdays && Array.isArray(publishedRota.includedWeekdays)) {
          // If we're in edit mode for a published rota, we want to keep showing the same days
          return !publishedRota.includedWeekdays.includes(dayLabel);
        }
        
        // Otherwise, use the current selection state
        return selectedWeekdays.indexOf(dayLabel) === -1;
      }
      
      // For a specific rota (published or not), try to use its included weekdays
      if (rotaId) {
        const rota = allRotas.find((r: any) => r._id === rotaId);
        if (rota) {
          // If this rota has includedWeekdays data, use it
          if (rota.includedWeekdays && Array.isArray(rota.includedWeekdays)) {
            return !rota.includedWeekdays.includes(dayLabel);
          }
          // If the rota is missing includedWeekdays data, try to get it from the original rota
          else if (rota.originalRotaId) {
            const originalRota = allRotas.find((r: any) => r._id === rota.originalRotaId);
            if (originalRota && originalRota.includedWeekdays && Array.isArray(originalRota.includedWeekdays)) {
              return !originalRota.includedWeekdays.includes(dayLabel);
            }
          }
        }
      } else {
        // If we can't find a rota for this day but it's a weekend (Saturday or Sunday),
        // it's likely that it should be deselected
        if (dayLabel === "Saturday" || dayLabel === "Sunday") {
          return true;
        }
      }
      
      // If we haven't been able to determine from a published rota:
      // In edit mode, use the current selectedWeekdays state
      // In view mode, default to included (weekdays) or excluded (weekends)
      if (!effectiveViewOnly) {
        return selectedWeekdays.indexOf(dayLabel) === -1;
      } else {
        // Default weekday selection for view mode if no published rota data available
        return (dayLabel === "Saturday" || dayLabel === "Sunday");
      }
    } catch (error) {
      console.error('[isDeselectedDay] Error determining if day is deselected:', error);
      return false; // Default to included if there's an error
    }
  // We're explicitly NOT including rotaIdsByDate in the dependency array
  // to prevent infinite loops when the function is used in effects that update rotaIdsByDate
  }, [effectiveViewOnly, publishedRota, selectedWeekdays]);
  
  // Add the custom CSS styles to the document
  useEffect(() => {
    // Add style tag if it doesn't exist
    if (!document.getElementById('not-selected-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'not-selected-styles';
      styleEl.textContent = notSelectedStyles;
      document.head.appendChild(styleEl);
      
      // Cleanup style tag on unmount
      return () => {
        const styleEl = document.getElementById('not-selected-styles');
        if (styleEl) {
          document.head.removeChild(styleEl);
        }
      };
    }
  }, []);
  
  // Helper: Create a Not Selected overlay component for consistent display
  const NotSelectedOverlay = React.memo(() => (
    <div className="not-selected-overlay">
      <span className="text-gray-500 font-medium text-xs">Not Selected</span>
    </div>
  ));
  
  // Helper function to create text input for cells
  const createCellTextInput = (cellElement: HTMLElement, cellKey: string, currentValue: string, bgColor: string) => {
    if (isViewOnly) return;
    
    // Create a contained div for our input
    const container = document.createElement('div');
    container.classList.add('p-1');
    container.style.backgroundColor = bgColor;
    
    // Replace cell content
    cellElement.innerHTML = '';
    cellElement.appendChild(container);
    
    // Create the input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'w-full p-1 text-xs border';
    input.value = currentValue;
    
    // Add input to container
    container.appendChild(input);
    
    // Focus the input
    input.focus();
    
    // Handle input blur
    input.addEventListener('blur', () => {
      cellElement.innerHTML = '';
      cellElement.textContent = input.value;
      
      // Update free text in state
      if (input.value !== currentValue) {
        const updatedFreeCellText = {
          [cellKey]: input.value
        };
        
        setFreeCellText(prev => ({
          ...prev,
          ...updatedFreeCellText
        }));
        
        // If in edit mode of published rota, notify parent about changes
        if (!effectiveViewOnly && onEditsChanged) {
          onEditsChanged({ freeCellText: updatedFreeCellText });
        }
      }
    });
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });
  };

  // In edit mode, we only want to see draft rotas
  // These state variables have been moved to the top of the component
  // to avoid circular dependencies with isDeselectedDay function
  // Track ad-hoc unavailable rules added during rota generation
  const [rotaUnavailableRules, setRotaUnavailableRules] = useState<Record<string, { dayOfWeek: string, startTime: string, endTime: string }[]>>({});
  
  // Track which permanent unavailable rules to ignore (when user deselects them)
  const [ignoredUnavailableRules, setIgnoredUnavailableRules] = useState<Record<string, number[]>>({});
  const [singlePharmacistDispensaryDays, setSinglePharmacistDispensaryDays] = useState<string[]>([]);
  // Weekdays are now defined at the top of the component
  const [bankHolidays, setBankHolidays] = useState<BankHoliday[]>([]);
  const [bankHolidayDates, setBankHolidayDates] = useState<Record<string, string>>({});
  const [pharmacistSearch, setPharmacistSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<{
    rotaId: Id<"rotas">,
    assignmentIndices: number[],
    currentPharmacistId: Id<"pharmacists"> | null,
    location: string,
    date: string,
    startTime?: string,
    endTime?: string,
    otherPharmacistIds?: Id<"pharmacists">[],  // Track other pharmacists in the same cell
    newAssignment?: {
      location: string,
      type: "ward" | "dispensary" | "clinic" | "management",
      startTime: string,
      endTime: string,
      isLunchCover?: boolean
    }
  } | null>(null);

  // For drag and drop functionality to swap pharmacists
  const [dragSource, setDragSource] = useState<{
    pharmacistId: Id<"pharmacists">,
    assignment: any,
    location: string,
    date: string,
    startTime: string,
    endTime: string
  } | null>(null);
  
  const [dragTarget, setDragTarget] = useState<{
    pharmacistId: Id<"pharmacists"> | null,
    assignment: any | null,
    location: string,
    date: string,
    startTime: string,
    endTime: string
  } | null>(null);

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
        return overlapping;
      }
      
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
  
  // Helper: Get pharmacists with protected rota time for a specific day and slot
  function getProtectedRotaTimePharmacists(dateStr: string, slot: { start: string, end: string }) {
    const date = new Date(dateStr);
    const dayLabel = DAYS[date.getDay()];
    
    return pharmacists.filter((p: any) => {
      // Check for permanent protected rota time
      const hasPermanentProtectedTime = p.notAvailableRules && Array.isArray(p.notAvailableRules) && 
        p.notAvailableRules.some((rule: any) => {
          if (rule.dayOfWeek !== dayLabel) return false;
          
          // Check if the permanent rule times overlap with this slot
          const ruleStart = rule.startTime;
          const ruleEnd = rule.endTime;
          
          return (ruleStart <= slot.start && ruleEnd > slot.start) || 
                 (ruleStart < slot.end && ruleEnd >= slot.end) ||
                 (ruleStart >= slot.start && ruleEnd <= slot.end);
        });
      
      // Check for ad-hoc protected rota time set during rota creation
      const hasAdHocProtectedTime = rotaUnavailableRules[p._id] && 
        rotaUnavailableRules[p._id].some((rule: any) => {
          if (rule.dayOfWeek !== dayLabel) return false;
          
          // Check if the ad-hoc rule times overlap with this slot
          const ruleStart = rule.startTime;
          const ruleEnd = rule.endTime;
          
          return (ruleStart <= slot.start && ruleEnd > slot.start) || 
                 (ruleStart < slot.end && ruleEnd >= slot.end) ||
                 (ruleStart >= slot.start && ruleEnd <= slot.end);
        });
      
      // Return true if the pharmacist has either permanent or ad-hoc protected time
      return hasPermanentProtectedTime || hasAdHocProtectedTime;
    });
  }

  // Helper: Get unavailable pharmacists for a given day
  function isPharmacistNotAvailable(pharmacist: any, dayLabel: string, slot: { start: string, end: string }) {
    return getAllUnavailableRules(pharmacist).some((rule: any) =>
      rule.dayOfWeek === dayLabel && !(slot.end <= rule.startTime || slot.start >= rule.endTime)
    );
  }

  // Helper: get all unavailable rules (permanent + rota-specific) excluding ignored rules
  function getAllUnavailableRules(pharmacist: any) {
    // Get the pharmacist's permanent unavailable rules, filtering out any that are ignored
    const permanentRules = (pharmacist.notAvailableRules || []).filter((rule: any, index: number) => {
      const ignoredIndices = ignoredUnavailableRules[pharmacist._id] || [];
      return !ignoredIndices.includes(index);
    });
    
    // Add any ad-hoc unavailable rules specific to this rota generation
    return [
      ...permanentRules,
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
  
  // Toggle a permanent unavailable rule as ignored/not ignored
  function toggleUnavailableRule(pharmacistId: string, ruleIndex: number, ignored: boolean) {
    setIgnoredUnavailableRules(prev => {
      const currentIgnored = prev[pharmacistId] || [];
      
      if (ignored) {
        // Add the rule index to ignored list if it's not already there
        if (!currentIgnored.includes(ruleIndex)) {
          return { ...prev, [pharmacistId]: [...currentIgnored, ruleIndex] };
        }
      } else {
        // Remove the rule index from ignored list
        const updated = currentIgnored.filter(idx => idx !== ruleIndex);
        return { ...prev, [pharmacistId]: updated };
      }
      
      return prev;
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

  // Helper: Create a new assignment safely through the API
  const createOrUpdateAssignment = async (rotaId: Id<"rotas">, assignment: any, pharmacistId: Id<"pharmacists">) => {
    try {
      // Always create a new assignment instead of trying to update by index (which can cause out-of-bounds errors)
      await updateAssignment({
        rotaId,
        assignmentIndex: -1, // Create new assignment instead of updating
        pharmacistId,
        newAssignment: {
          location: assignment.location,
          type: assignment.type,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
          isLunchCover: assignment.isLunchCover
        }
      });
      return true;
    } catch (error) {
      console.error('[createOrUpdateAssignment] Error:', error);
      return false;
    }
  };
  
  // Helper: Find the assignment index in the backend rota
  const findAssignmentIndex = (rotaId: Id<"rotas">, assignment: any) => {
    // Find the rota in allRotas
    const rota = allRotas.find((r: any) => r._id === rotaId);
    if (!rota || !rota.assignments) {
      console.error('[findAssignmentIndex] Rota not found or has no assignments');
      return -1;
    }
    
    // Find the assignment index
    const index = rota.assignments.findIndex((a: any) => 
      a.pharmacistId === assignment.pharmacistId &&
      a.location === assignment.location &&
      ((a.startTime === assignment.startTime && a.endTime === assignment.endTime) ||
       (a.startTime === '00:00' && a.endTime === '23:59'))
    );
    
    if (index === -1) {
      console.error('[findAssignmentIndex] Assignment not found in rota');
    }
    
    return index;
  };
  
  // Handle reset - return to original algorithm-generated rota
  const handleReset = async () => {
    console.log('[handleReset] Starting reset process...');
    
    if (!selectedMonday) {
      console.log('[handleReset] No selected Monday, cannot reset');
      return;
    }
    
    try {
      // Clear all UI state first
      setDragSource(null);
      setDragTarget(null);
      setShowPharmacistSelection(false);
      
      // Set loading indicator
      setGeneratingWeekly(true);
      
      console.log('[handleReset] Handling reset for rota with selectedMonday:', selectedMonday);
      
      // Handle reset differently based on whether we're editing a published rota
      if (publishedRota && !effectiveViewOnly && initialRotaAssignments && initialRotaIdsByDate) {
        // For published rotas in edit mode, simply restore to the initial data without regenerating
        console.log('[handleReset] Editing published rota - restoring original assignments');
        
        // First clear temporary changes
        setEauAdditionalRows([]);
        setIgnoredUnavailableRules({});
        setRotaUnavailableRules({});
        setFreeCellText({});
        
        // Restore original assignments
        setRotaIdsByDate(initialRotaIdsByDate);
        setRotaAssignments(initialRotaAssignments);
        
        // Notify parent component to ensure published rota connection is maintained
        if (onEditsChanged) {
          onEditsChanged({
            assignments: initialRotaAssignments,
            freeCellText: {}
          });
        }
        
        console.log('[handleReset] Reset to initial published rota assignments complete');
      } else {
        // For normal rotas (not editing published), regenerate completely
        console.log('[handleReset] Standard reset - regenerating rota');
        
        // Clear modifications
        setEauAdditionalRows([]);
        setIgnoredUnavailableRules({});
        setRotaUnavailableRules({});
        setFreeCellText({});
        
        // Call the API to regenerate the rota completely
        await handleGenerateWeeklyRota(undefined, true);
      }
      
      setTimeout(() => {
        console.log('[handleReset] Reset completed successfully.');
      }, 500);
      
    } catch (error) {
      console.error('[handleReset] Error during reset:', error);
      alert('There was an error resetting the rota. Please try refreshing the page.');
    } finally {
      setTimeout(() => {
        setGeneratingWeekly(false);
        console.log('[handleReset] Reset process completed');
      }, 1000);
    }
  };

  // useEffect to populate rotaAssignments from allRotas for display or from initialRotaAssignments for editing
  useEffect(() => {
    console.log('[useEffect][populate rotaAssignments] Dependencies changed. Finding new assignments...');
    
    // Handle special case: when we're showing published rotas in edit mode,
    // we should maintain the initialRotaAssignments and not recompute from allRotas
    if (initialRotaAssignments && initialRotaAssignments.length > 0 && initialRotaIdsByDate && !effectiveViewOnly) {
      console.log(`[populate rotaAssignments] Using initialRotaAssignments for edit mode: ${initialRotaAssignments.length} assignments`);
      // Set state in one batch to avoid flicker
      setRotaIdsByDate(initialRotaIdsByDate);
      setRotaAssignments(initialRotaAssignments);
      return;
    }
    
    // Always prioritize initialRotaAssignments when in edit mode - this prevents table from disappearing
    if (!effectiveViewOnly && initialRotaAssignments && initialRotaAssignments.length > 0) {
      console.log(`[populate rotaAssignments] Using initialRotaAssignments for edit mode: ${initialRotaAssignments.length} assignments`);
      // We do this check even if we already have rotaAssignments to ensure consistent state
      if (initialRotaIdsByDate) {
        setRotaIdsByDate(initialRotaIdsByDate);
      }
      setRotaAssignments(initialRotaAssignments);
      return;
    }
    
    // Don't clear existing assignments before we have new ones ready
    if (rotaAssignments.length > 0 && allRotas.length === 0) {
      console.log('[populate rotaAssignments] Preserving existing assignments');
      return;
    }
    
    if (allRotas.length > 0) {
      // Create a map of date to rota ID
      const newRotaIdsByDate: Record<string, Id<"rotas">> = {};
      // Collect all assignments from all rotas
      const allAssignments: any[] = [];
      // Collect all free cell text from rotas
      const allFreeCellText: Record<string, string> = {};

      // When viewing published rotas, ensure we're not adding assignments for deselected days
      for (const rota of allRotas) {
        // Normalize date to YYYY-MM-DD format
        const dateObj = new Date(rota.date);
        const dateStr = dateObj.toISOString().split('T')[0];
        newRotaIdsByDate[dateStr] = rota._id;

        // Extract weekday from the date
        const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const dayLabel = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
        
        // Check if this day should be included
        // Special behavior for edit mode on published rotas - use selectedWeekdays
        let isDayIncluded = true;
        
        // Create a date object to check if day is deselected
        const dayDate = new Date(dateStr);
        // Use our isDeselectedDay function for consistent behavior with the UI
        const isDeselected = isDeselectedDay(dayDate);
        isDayIncluded = !isDeselected;
        
        // Always store the mapping between dates and rota IDs, even for deselected days
        // This is needed for the isDeselectedDay function to work correctly
        newRotaIdsByDate[dateStr] = rota._id;
        
        // Process free cell text if present (even for deselected days)
        if (rota.freeCellText && typeof rota.freeCellText === 'object') {
          // Merge into our combined state
          Object.entries(rota.freeCellText).forEach(([key, value]) => {
            allFreeCellText[key] = value;
          });
        }
        
        // Only add assignments for included (not deselected) days
        if (isDayIncluded && Array.isArray(rota.assignments)) {
          // Add date field to each assignment for easier filtering
          const assignmentsWithDate = rota.assignments.map((a: any) => ({
            ...a,
            date: dateStr
          }));
          allAssignments.push(...assignmentsWithDate);
        }
      }

      setRotaIdsByDate(newRotaIdsByDate);
      
      // Update UI with the assignments and free cell text
      setRotaAssignments(allAssignments);
      setFreeCellText(allFreeCellText); // Use the free cell text from rotas
      console.log(`[populate rotaAssignments] Total assignments loaded: ${allAssignments.length}`);
    }
  // We're explicitly NOT including rotaIdsByDate and rotaAssignments in the dependency array
  // to prevent infinite loops, as we update them in the effect
  // effectiveViewOnly change is handled specially to ensure table never disappears
  }, [allRotas, initialRotaAssignments, initialRotaIdsByDate, effectiveViewOnly, isViewOnly]);

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
    if (isViewOnly) return;
    
    // Don't clear assignments until we have new ones
    // Only set rotaGenerated to false to indicate we need a new generation
    setRotaGenerated(false);
    
    // Detect bank holidays for the selected week
    if (selectedMonday) {
      const startDate = new Date(selectedMonday);
      const endDate = new Date(selectedMonday);
      endDate.setDate(startDate.getDate() + 6); // End of week (Sunday)
      
      const holidays = getBankHolidaysInRange(startDate, endDate);
      setBankHolidays(holidays);
      
      // Create a mapping of date to holiday name
      const holidayMap: Record<string, string> = {};
      holidays.forEach(h => {
        holidayMap[h.date] = h.title;
      });
      setBankHolidayDates(holidayMap);
      
      // Automatically deselect bank holidays
      if (holidays.length > 0) {
        // Map from ISO dates to weekday names
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const holidayWeekdays = holidays.map(h => {
          const date = new Date(h.date);
          return dayNames[date.getDay()];
        });
        
        // Update selected weekdays to exclude bank holidays
        setSelectedWeekdays(prev => {
          return prev.filter(day => !holidayWeekdays.includes(day));
        });
      }
    }
  }, [selectedMonday, effectiveViewOnly]);

  // Reimplemented publish rota function that creates a carbon copy of weekly rotas
  const publishRota = useMutation(api.rotas.publishRota);
  
  // First, let's add a function to save free cell text to rotas
  const saveFreeCellTextToRota = useMutation(api.rotas.saveFreeCellText);

  const handlePublishRota = async () => {
    setIsPublishing(true);
    try {
      // Get the IDs for all rotas in the current week
      const rotaIds = Object.values(rotaIdsByDate);
      if (rotaIds.length === 0) {
        alert("No rotas to publish");
        setIsPublishing(false);
        return;
      }
      
      // First, let's save the free cell text to all rotas that will be published
      console.log("Saving free cell text before publishing:", freeCellText);
      
      // Group free cell text by date
      const textByDate: Record<string, Record<string, string>> = {};
      
      // For each cell text entry, extract the date from the key and group
      Object.entries(freeCellText).forEach(([key, value]) => {
        let dateStr = '';
        
        // There are different formats depending on the cell type:
        // 1. dispensary-Dispensary-YYYY-MM-DD-start-end
        // 2. clinic-ClinicName-YYYY-MM-DD-start-end
        // 3. unavailable-YYYY-MM-DD-start-end (no location part)
        // 4. management-YYYY-MM-DD-start-end (no location part)
        
        const parts = key.split('-');
        
        if (key.startsWith('unavailable-') || key.startsWith('management-')) {
          // Extract date for unavailable/management format: type-YYYY-MM-DD-start-end
          if (parts.length >= 4) {
            dateStr = `${parts[1]}-${parts[2]}-${parts[3]}`;
          }
        } else {
          // Extract date for dispensary/clinic format: type-location-YYYY-MM-DD-start-end
          if (parts.length >= 5) {
            dateStr = `${parts[2]}-${parts[3]}-${parts[4]}`;
          }
        }
        
        if (dateStr) {
          console.log(`Extracted date ${dateStr} from key ${key}`);
          if (!textByDate[dateStr]) {
            textByDate[dateStr] = {};
          }
          textByDate[dateStr][key] = value;
        } else {
          console.error(`Could not extract date from key: ${key}`);
        }
      });
      
      // For each rota, save its relevant free cell text
      for (const rotaId of rotaIds) {
        const rotaDate = Object.entries(rotaIdsByDate).find(([date, id]) => id === rotaId)?.[0];
        if (rotaDate && textByDate[rotaDate]) {
          await saveFreeCellTextToRota({
            rotaId,
            freeCellText: textByDate[rotaDate]
          });
          console.log(`Saved free cell text for rota ${rotaId} (${rotaDate}):`, textByDate[rotaDate]);
        }
      }
      
      // Now publish the entire week's rotas as carbon copies (with the saved free cell text)
      const firstRotaId = rotaIds[0];
      const result = await publishRota({ 
        rotaId: firstRotaId,
        userName: currentUser.name || currentUser.email || 'Unknown User',
        weekStartDate: selectedMonday
      });
      
      console.log("Published rotas:", result);
      
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000); // Clear success message after 3 seconds
    } catch (error) {
      console.error("Error publishing rota:", error);
      alert(`Error publishing rota: ${error}`);
    } finally {
      setIsPublishing(false);
    }
  };

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
      // Create a structure for additional unavailable rules that combines ad-hoc rules
      // with permanent rules that haven't been ignored
      const effectiveUnavailableRules: Record<string, { dayOfWeek: string, startTime: string, endTime: string }[]> = {};
      
      // For each pharmacist, prepare their effective unavailable rules
      selectedPharmacistIds.forEach(pharmacistId => {
        const pharmacist = pharmacists.find((p: any) => p._id === pharmacistId);
        if (pharmacist) {
          // Use the getAllUnavailableRules helper to get the effective rules
          effectiveUnavailableRules[pharmacistId] = getAllUnavailableRules(pharmacist);
        }
      });

      console.log('[handleGenerateWeeklyRota] Using effective unavailable rules:', effectiveUnavailableRules);
      console.log('[handleGenerateWeeklyRota] Using selected weekdays:', selectedWeekdays);
      
      await generateWeeklyRota({
        startDate: selectedMonday,
        pharmacistIds: selectedPharmacistIds,
        clinicIds: selectedClinicIds,
        pharmacistWorkingDays: pharmacistWorkingDays,
        singlePharmacistDispensaryDays: daysToUse, // Pass the determined state
        regenerateRota: regenerateRota, // Pass the regenerateRota flag
        effectiveUnavailableRules: effectiveUnavailableRules, // Pass the composite unavailable rules
        selectedWeekdays: selectedWeekdays, // Pass the selected weekdays to include in generation
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
  // Function to generate and download a PDF of the rota
  const handleDownloadPDF = async () => {
    try {
      console.log('[handleDownloadPDF] Starting PDF generation');
      // Get the table element
      const tableElement = document.querySelector('.rota-table');
      if (!tableElement) {
        console.error('[handleDownloadPDF] Table element not found');
        return;
      }
      
      // Create a loading indicator
      const loadingDiv = document.createElement('div');
      loadingDiv.style.position = 'fixed';
      loadingDiv.style.top = '50%';
      loadingDiv.style.left = '50%';
      loadingDiv.style.transform = 'translate(-50%, -50%)';
      loadingDiv.style.background = 'rgba(255,255,255,0.9)';
      loadingDiv.style.padding = '20px';
      loadingDiv.style.borderRadius = '8px';
      loadingDiv.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
      loadingDiv.style.zIndex = '9999';
      loadingDiv.innerHTML = '<p style="font-weight:bold;margin:0">Generating PDF...</p>';
      document.body.appendChild(loadingDiv);
      
      // Use html2canvas to capture the table as an image
      console.log('[handleDownloadPDF] Capturing table with html2canvas');
      const canvas = await html2canvas(tableElement as HTMLElement, {
        scale: 1.5, // Higher quality
        useCORS: true,
        logging: true,
        onclone: (clonedDoc) => {
          // Find the cloned table and make it visible for capturing
          const clonedTable = clonedDoc.querySelector('.rota-table');
          if (clonedTable) {
            (clonedTable as HTMLElement).style.overflow = 'visible';
            (clonedTable as HTMLElement).style.width = 'auto';
          }
        }
      });
      
      // Calculate optimal PDF page size (landscape)
      const imgWidth = 280; // A4 width in mm (landscape)
      const imgHeight = canvas.height * imgWidth / canvas.width;
      
      // Create PDF (A4 landscape)
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      
      // Add title
      const weekStart = new Date(selectedMonday);
      const weekEnd = new Date(selectedMonday);
      weekEnd.setDate(weekEnd.getDate() + 4); // Friday
      
      pdf.setFontSize(16);
      pdf.text('STDH Pharmacy Rota', 15, 15);
      pdf.setFontSize(12);
      pdf.text(`Week of ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`, 15, 22);
  
      
      // Add the table image
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95), // Use JPEG for smaller file size
        'JPEG',
        10, // x position
        35, // y position
        imgWidth, // width
        imgHeight // height
      );
      
      // Save the PDF
      pdf.save(`STDH_Pharmacy_Rota_${selectedMonday}.pdf`);
      console.log('[handleDownloadPDF] PDF generated and saved');
      
      // Remove loading indicator
      document.body.removeChild(loadingDiv);
    } catch (error) {
      console.error('[handleDownloadPDF] Error generating PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };
  
  // For viewing an existing rota, use clinic assignments from rota data
  // For creating a new rota, use the selected clinics from the UI
  const sortedSelectedClinics = useMemo(() => {
    // Extract clinic IDs from active assignments in the current rota
    // Only consider assignments for days that are not deselected
    const clinicIdsInRota = new Set(
      rotaAssignments
        .filter(a => {
          // Only include clinics that are currently active in the rota
          if (a.type !== "clinic") return false;
          
          // Check if the assignment's date is for a deselected day
          const assignmentDate = new Date(a.date);
          const isDeselected = isDeselectedDay(assignmentDate);
          
          // Only include clinics for days that are selected
          return !isDeselected;
        })
        .map(a => {
          // Find the clinic object that matches this location
          const clinic = clinics.find(c => c.name === a.location);
          return clinic ? clinic._id : null;
        })
        .filter(Boolean) // Remove null values
    );
    
    // Determine which clinic IDs to display in the rota
    // If we're viewing a rota, use the IDs from active assignments (filtered above)
    // If we're creating a new rota, use the IDs that the user has explicitly selected
    const clinicIdsToUse = effectiveViewOnly && clinicIdsInRota.size > 0 
      ? Array.from(clinicIdsInRota)
      : selectedClinicIds;
    
    console.log('[sortedSelectedClinics] Clinic IDs in rota:', Array.from(clinicIdsInRota));
    console.log('[sortedSelectedClinics] Selected clinic IDs from UI:', selectedClinicIds);
    console.log('[sortedSelectedClinics] Using clinic IDs:', clinicIdsToUse);
    console.log('[sortedSelectedClinics] View only mode:', effectiveViewOnly);
    
    // Filter and sort clinics for display
    return clinics
      .filter((c: any) => clinicIdsToUse.includes(c._id))
      .sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime));
  }, [clinics, rotaAssignments, selectedClinicIds, effectiveViewOnly, isDeselectedDay]);

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

  // Define the return type to include the exactTimeMatch property
  type AssignmentScopeResult = { 
    rotaId: Id<"rotas">; 
    indices: number[];
    exactTimeMatch?: boolean;
  };

  // Add helper to get assignments for scope
  const getAssignmentsForScope = (
  location: string, 
  date: string, 
  scope: "slot" | "day" | "week",
  startTime?: string,
  endTime?: string,
  currentPharmacistId?: Id<"pharmacists"> | null
): AssignmentScopeResult[] => {
  console.log(`[getAssignmentsForScope] Called with scope: ${scope}, location: ${location}, date: ${date}, startTime: ${startTime}, endTime: ${endTime}`);
  const results: AssignmentScopeResult[] = [];
  
  try {
    const isWard = location.includes("Ward") || location.includes("ITU") || location.includes("Emergency Assessment Unit");
    
    if (scope === "slot") {
      // For single slot, get the exact assignment
      const rotaId = rotaIdsByDate[date];
      if (!rotaId) {
        console.error(`[getAssignmentsForScope] No rota found for date: ${date}`);
        return results;
      }

      const rota = allRotas.find((r: any) => r._id === rotaId);
      if (!rota) {
        console.error(`[getAssignmentsForScope] Rota not found in allRotas for ID: ${rotaId}`);
        return results;
      }
      
      // Ensure startTime and endTime are provided for slot scope
      if (!startTime || !endTime) {
        console.error("[getAssignmentsForScope] StartTime or EndTime missing for 'slot' scope.");
        return results;
      }
      
      // Find exact time slot matches for this location
      const exactMatches = rota.assignments
        .map((a: any, idx: number) => ({ ...a, idx }))
        .filter((a: any) => 
          a.location === location && 
          a.startTime === startTime && 
          a.endTime === endTime
        )
        .map((a: any) => a.idx);
      
      console.log(`[getAssignmentsForScope] Found ${exactMatches.length} exact matches for ${location} at ${startTime}-${endTime}`);
      
      // If we found exact time-specific assignments for this slot, use those
      if (exactMatches.length > 0) {
        console.log(`[getAssignmentsForScope] Found exact match assignments for slot: ${exactMatches.join(', ')}`);
        return [{
          rotaId,
          indices: exactMatches,
          exactTimeMatch: true
        }];
      }
      
      // If we have a specific pharmacist ID, look for overlapping assignments for that pharmacist
      if (currentPharmacistId) {
        const overlappingAssignments = rota.assignments
          .map((a: any, idx: number) => ({ ...a, idx, pharmacistId: a.pharmacistId }))
          .filter((a: any) => 
            a.location === location && 
            a.pharmacistId === currentPharmacistId &&
            a.startTime <= startTime && 
            a.endTime >= endTime
          );
          
        if (overlappingAssignments.length > 0) {
          console.log(`[getAssignmentsForScope] Found ${overlappingAssignments.length} overlapping assignments with specific pharmacist`);
          return [{
            rotaId,
            indices: [overlappingAssignments[0].idx],
            exactTimeMatch: false
          }];
        }
      }
      
      // If no exact match or pharmacist-specific assignment, try for any overlapping assignment
      const overlappingAssignments = rota.assignments
        .map((a: any, idx: number) => ({ ...a, idx }))
        .filter((a: any) => 
          a.location === location && 
          a.startTime <= startTime && 
          a.endTime >= endTime
        );
        
      if (overlappingAssignments.length > 0) {
        console.log(`[getAssignmentsForScope] Found ${overlappingAssignments.length} overlapping assignments`);
        return [{
          rotaId,
          indices: [overlappingAssignments[0].idx],
          exactTimeMatch: false
        }];
      }
      
      // No assignments found at all, will create a new one
      console.log(`[getAssignmentsForScope] No assignments found for this slot. Will create new one.`);
      return [];
      
    } else if (scope === "day") {
      // For day, get all assignments for this location on this date
      const rotaId = rotaIdsByDate[date];
      if (!rotaId) {
        console.error(`[getAssignmentsForScope] No rota found for date: ${date}`);
        return results;
      }

      const rota = allRotas.find((r: any) => r._id === rotaId);
      if (!rota) {
        console.error(`[getAssignmentsForScope] Rota not found in allRotas for ID: ${rotaId}`);
        return results;
      }
      
      // Get all assignments for this location
      const allAssignments = rota.assignments
        .map((a: any, idx: number) => ({ ...a, idx, pharmacistId: a.pharmacistId }))
        .filter((a: any) => a.location === location);
        
      console.log(`[getAssignmentsForScope] Found ${allAssignments.length} assignments for day scope`);
      
      if (allAssignments.length > 0) {
        // If we have a currentPharmacistId, find only assignments with that pharmacist
        if (currentPharmacistId) {
          console.log(`[getAssignmentsForScope] Looking for day assignments with pharmacistId: ${currentPharmacistId}`);
          
          // Find assignments with this specific pharmacist
          const specificAssignments = allAssignments.filter(a => 
            a.pharmacistId === currentPharmacistId
          );
          
          if (specificAssignments.length > 0) {
            const specificIndices = specificAssignments.map(a => a.idx);
            console.log(`[getAssignmentsForScope] Found ${specificIndices.length} specific assignments for pharmacist ${currentPharmacistId}: ${specificIndices.join(', ')}`);
            results.push({ rotaId, indices: specificIndices });
            return results;
          } else {
            console.log(`[getAssignmentsForScope] No specific assignments found for pharmacist ${currentPharmacistId}`);
            return [];
          }
        } else {
          // If no specific pharmacist ID provided, return all assignments
          const allIndices = allAssignments.map(a => a.idx);
          console.log(`[getAssignmentsForScope] No specific pharmacist ID provided, returning all ${allIndices.length} assignments`);
          results.push({ rotaId, indices: allIndices });
        }
      }
      
    } else { // week scope
      // For week, get all assignments for this location across all rotas
      console.log(`[getAssignmentsForScope] Scope: week, Checking all rotas for location: ${location}`);
      
      // Iterate through all days in the week
      Object.entries(rotaIdsByDate).forEach(([currentDate, rotaId]) => {
        const rota = allRotas.find((r: any) => r._id === rotaId);
        if (!rota) {
          console.error(`[getAssignmentsForScope] Rota not found in allRotas for ID: ${rotaId} on date ${currentDate}`);
          return;
        }
        
        // Get all assignments for this location
        const allAssignments = rota.assignments
          .map((a: any, idx: number) => ({ ...a, idx, pharmacistId: a.pharmacistId }))
          .filter((a: any) => a.location === location);
          
        console.log(`[getAssignmentsForScope] Found ${allAssignments.length} assignments for week scope on ${currentDate}`);
        
        if (allAssignments.length > 0) {
          // If we have a currentPharmacistId, find only assignments with that pharmacist
          if (currentPharmacistId) {
            console.log(`[getAssignmentsForScope] Looking for week assignments with pharmacistId: ${currentPharmacistId}`);
            
            // Find assignments with this specific pharmacist
            const specificAssignments = allAssignments.filter(a => 
              a.pharmacistId === currentPharmacistId
            );
            
            if (specificAssignments.length > 0) {
              const specificIndices = specificAssignments.map(a => a.idx);
              console.log(`[getAssignmentsForScope] Found ${specificIndices.length} specific assignments for pharmacist ${currentPharmacistId} on ${currentDate}: ${specificIndices.join(', ')}`);
              results.push({ rotaId, indices: specificIndices });
            } else {
              console.log(`[getAssignmentsForScope] No specific assignments found for pharmacist ${currentPharmacistId} on ${currentDate}`);
            }
          } else {
            // If no specific pharmacist ID provided, return all assignments
            const allIndices = allAssignments.map(a => a.idx);
            console.log(`[getAssignmentsForScope] No specific pharmacist ID provided, returning all ${allIndices.length} assignments for ${currentDate}`);
            results.push({ rotaId, indices: allIndices });
          }
        } else {
          console.log(`[getAssignmentsForScope] No assignments found for week scope on ${currentDate}`);
        }
      });
    }

    console.log('[getAssignmentsForScope] Returning results:', JSON.stringify(results));
    return results;
  } catch (error) {
    console.error(`[getAssignmentsForScope] Error:`, error);
    return results;
  }
};

  // Add helper to determine the assignments to display in a specific cell (returns array to handle multiple pharmacists)
const getAssignmentsForCell = (
  location: string,
  date: string,
  slotStartTime: string,
  slotEndTime: string,
  allAssignmentsForDate: any[] // Pass the relevant rota.assignments array for the specific date
): any[] => {
  // Determine if it's a ward
  const isWard = location.includes("Ward") || location.includes("ITU") || location.includes("Emergency Assessment Unit");
  const assignments = [];

  // 1. Check for exact slot matches
  const specificAssignments = allAssignmentsForDate.filter(a =>
    a.location === location &&
    a.startTime === slotStartTime &&
    a.endTime === slotEndTime
  );

  if (specificAssignments.length > 0) {
    return specificAssignments;
  }

  // 2. If it's a ward and no specific assignments found, check for full-day assignments
  if (isWard) {
    const fullDayAssignments = allAssignmentsForDate.filter(a =>
      a.location === location &&
      a.startTime === '00:00' &&
      a.endTime === '23:59'
    );
    if (fullDayAssignments.length > 0) {
      return fullDayAssignments;
    }
  }

  // 3. No assignments found
  return [];
};

// Backward compatibility function - returns the first assignment or null for old code
const getAssignmentForCell = (
  location: string,
  date: string,
  slotStartTime: string,
  slotEndTime: string,
  allAssignmentsForDate: any[]
): any | null => {
  const assignments = getAssignmentsForCell(location, date, slotStartTime, slotEndTime, allAssignmentsForDate);
  return assignments.length > 0 ? assignments[0] : null;
};  

  // Drag and drop functions for swapping pharmacists
  const handleDragStart = (
    event: React.DragEvent<HTMLSpanElement>, 
    pharmacistId: Id<"pharmacists">, 
    assignment: any,
    location: string,
    date: string,
    slotStartTime: string,
    slotEndTime: string
  ) => {
    if (effectiveViewOnly) return; // Prevent drag in view-only mode
    
    // Set dragSource with the current cell's data
    setDragSource({
      pharmacistId,
      assignment,
      location,
      date,
      startTime: slotStartTime,
      endTime: slotEndTime
    });
    
    // Set drag data
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', pharmacistId as string);
    
    // Add visual feedback for source element
    const cells = document.querySelectorAll('.rota-drag-cell');
    cells.forEach(cell => {
      const cellPharmacistId = cell.getAttribute('data-pharmacist-id');
      const cellLocation = cell.getAttribute('data-location');
      const cellDate = cell.getAttribute('data-date');
      
      if (cellPharmacistId === pharmacistId && 
          cellLocation === location && 
          cellDate === date) {
        cell.classList.add('bg-yellow-100');
      }
    });
  };
  
  const handleDragOver = (
    event: React.DragEvent<HTMLTableDataCellElement>, 
    pharmacistId: Id<"pharmacists"> | null, 
    assignment: any | null, 
    location: string, 
    date: string, 
    slotStartTime: string, 
    slotEndTime: string
  ) => {
    if (effectiveViewOnly || !dragSource || !pharmacistId) return; // Don't allow dropping in view-only mode or if no drag started or no pharmacist to swap with
    
    // Don't allow dropping on the same cell that started the drag
    if (dragSource.pharmacistId === pharmacistId && 
        dragSource.date === date && 
        dragSource.location === location &&
        dragSource.startTime === slotStartTime &&
        dragSource.endTime === slotEndTime) {
      return;
    }
    
    // Allow dropping by preventing default
    event.preventDefault();
    
    // Update the dragTarget state
    setDragTarget({
      pharmacistId,
      assignment,
      location,
      date,
      startTime: slotStartTime,
      endTime: slotEndTime
    });
    
    // Add visual feedback
    const element = event.currentTarget;
    element.classList.add('bg-blue-100');
  };
  
  const handleDragLeave = (event: React.DragEvent<HTMLTableDataCellElement>) => {
    // Remove visual feedback
    event.currentTarget.classList.remove('bg-blue-100');
  };
  
  const handleDrop = (event: React.DragEvent<HTMLTableDataCellElement>) => {
    if (effectiveViewOnly || !dragSource || !dragTarget) return;
    
    event.preventDefault();
    
    // Remove visual feedback
    event.currentTarget.classList.remove('bg-blue-100');
    
    // Remove source highlight
    const cells = document.querySelectorAll('.rota-drag-cell');
    cells.forEach(cell => {
      cell.classList.remove('bg-yellow-100');
      cell.classList.remove('bg-blue-100');
    });
    
    // Check if we're trying to swap with the same cell
    if (dragSource.date === dragTarget.date && 
        dragSource.location === dragTarget.location &&
        dragSource.startTime === dragTarget.startTime &&
        dragSource.endTime === dragTarget.endTime) {
      return;
    }
    
    // Check if the target has a pharmacist (we only swap with cells that have pharmacists)
    if (!dragTarget.pharmacistId) {
      console.log('Target has no pharmacist, cannot swap');
      setDragSource(null);
      setDragTarget(null);
      return;
    }
    
    swapPharmacists();
  };
  
  const handleDragEnd = () => {
    // Reset drag states and remove visual highlights
    const cells = document.querySelectorAll('.rota-drag-cell');
    cells.forEach(cell => {
      cell.classList.remove('bg-yellow-100');
      cell.classList.remove('bg-blue-100');
    });
    
    setDragSource(null);
    setDragTarget(null);
  };
  
  // Function to swap pharmacists using the current drag source and target
  const swapPharmacists = async () => {
    if (!dragSource || !dragTarget || !dragTarget.pharmacistId) return;
    
    try {
      console.log('[swapPharmacists] Attempting to swap:', {
        source: {
          pharmacistId: dragSource.pharmacistId,
          location: dragSource.location,
          date: dragSource.date,
          startTime: dragSource.startTime,
          endTime: dragSource.endTime
        },
        target: {
          pharmacistId: dragTarget.pharmacistId,
          location: dragTarget.location,
          date: dragTarget.date,
          startTime: dragTarget.startTime,
          endTime: dragTarget.endTime
        }
      });
      
      // Find the source and target assignments
      const sourceAssignment = rotaAssignments.find(a =>
        a.pharmacistId === dragSource.pharmacistId && 
        a.date === dragSource.date && 
        a.location === dragSource.location &&
        ((a.startTime === dragSource.startTime && a.endTime === dragSource.endTime) ||
         (a.startTime === '00:00' && a.endTime === '23:59')) // Handle full-day assignments
      );
      
      const targetAssignment = rotaAssignments.find(a =>
        a.pharmacistId === dragTarget.pharmacistId && 
        a.date === dragTarget.date && 
        a.location === dragTarget.location &&
        ((a.startTime === dragTarget.startTime && a.endTime === dragTarget.endTime) ||
         (a.startTime === '00:00' && a.endTime === '23:59')) // Handle full-day assignments
      );
      
      if (!sourceAssignment || !targetAssignment) {
        console.error('[swapPharmacists] Could not find source or target assignment');
        return;
      }
      
      console.log('[swapPharmacists] Found assignments to swap');
      
      // Get the rota IDs for the source and target dates
      const sourceRotaId = rotaIdsByDate[dragSource.date];
      const targetRotaId = rotaIdsByDate[dragTarget.date];
      
      if (!sourceRotaId || !targetRotaId) {
        console.error('[swapPharmacists] Missing rota IDs');
        return;
      }
      
      // Swap the pharmacist IDs
      const sourcePharmacistId = dragSource.pharmacistId;
      const targetPharmacistId = dragTarget.pharmacistId;
      
      console.log(`[swapPharmacists] Swapping: ${sourcePharmacistId} with ${targetPharmacistId}`);
      
      // Create a new array with the swapped assignments for UI update
      const updatedAssignments = rotaAssignments.map(a => {
        // If this is the source assignment, change its pharmacist ID to the target
        if (a.pharmacistId === sourcePharmacistId && 
            a.date === dragSource.date && 
            a.location === dragSource.location &&
            ((a.startTime === dragSource.startTime && a.endTime === dragSource.endTime) ||
             (a.startTime === '00:00' && a.endTime === '23:59'))) {
          return { ...a, pharmacistId: targetPharmacistId };
        }
        
        // If this is the target assignment, change its pharmacist ID to the source
        if (a.pharmacistId === targetPharmacistId && 
            a.date === dragTarget.date && 
            a.location === dragTarget.location &&
            ((a.startTime === dragTarget.startTime && a.endTime === dragTarget.endTime) ||
             (a.startTime === '00:00' && a.endTime === '23:59'))) {
          return { ...a, pharmacistId: sourcePharmacistId };
        }
        
        return a;
      });
      
      // Update the local state first for immediate feedback (optimistic update)
      setRotaAssignments(updatedAssignments);
      
      console.log('[swapPharmacists] Swap completed');
      
      // Find the assignment indices in the backend data
      try {
        console.log('[swapPharmacists] Finding assignment indices in backend data');
        
        // Find the source and target rotas in allRotas
        const sourceRota = allRotas.find((r: any) => r._id === sourceRotaId);
        const targetRota = allRotas.find((r: any) => r._id === targetRotaId);
        
        if (!sourceRota || !targetRota) {
          console.error('[swapPharmacists] Could not find source or target rota in allRotas');
          return;
        }
        
        // Find the indices of the assignments in the backend data
        const sourceIndex = sourceRota.assignments.findIndex((a: any) => 
          a.pharmacistId === sourcePharmacistId && 
          a.location === dragSource.location &&
          ((a.startTime === dragSource.startTime && a.endTime === dragSource.endTime) ||
           (a.startTime === '00:00' && a.endTime === '23:59'))
        );
        
        const targetIndex = targetRota.assignments.findIndex((a: any) => 
          a.pharmacistId === targetPharmacistId && 
          a.location === dragTarget.location &&
          ((a.startTime === dragTarget.startTime && a.endTime === dragTarget.endTime) ||
           (a.startTime === '00:00' && a.endTime === '23:59'))
        );
        
        console.log(`[swapPharmacists] Found indices: source=${sourceIndex}, target=${targetIndex}`);
        
        if (sourceIndex === -1 || targetIndex === -1) {
          console.error('[swapPharmacists] Could not find assignment indices');
          return;
        }
        
        // Update the backend using the assignment indices
        console.log('[swapPharmacists] Updating backend with new assignments');
        
        // Update the source assignment with the target pharmacist
        await updateAssignment({
          rotaId: sourceRotaId,
          assignmentIndex: sourceIndex,
          pharmacistId: targetPharmacistId
        });
        
        // Update the target assignment with the source pharmacist
        await updateAssignment({
          rotaId: targetRotaId,
          assignmentIndex: targetIndex,
          pharmacistId: sourcePharmacistId
        });
        
        console.log('[swapPharmacists] Swap successful!');
      } catch (updateError) {
        console.error('[swapPharmacists] Error updating backend:', updateError);
        // If there's an error, revert the UI changes
        setRotaAssignments(rotaAssignments);
      }
    } catch (error) {
      console.error('[swapPharmacists] Error swapping pharmacists:', error);
    }
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
        type: type,
        startTime: start,
        endTime: end
      }
    });
    setShowPharmacistSelection(true);
  };

  // Add handler for cell click - handles individual pharmacist click within multi-pharmacist cell
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

    // In edit mode, we might not have the rota in allRotas, so we'll work with rotaAssignments directly
    let clickedAssignmentIndex = -1;
    let otherPharmacistIds: Id<"pharmacists">[] = [];
    
    // Try to find the rota in allRotas first
    const rota = allRotas.find((r: any) => r._id === rotaId);
    
    if (rota && rota.assignments) {
      // Regular mode: Find the clicked pharmacist's assignment index
      clickedAssignmentIndex = rota.assignments.findIndex((a: any) => 
        a.location === assignment.location && 
        a.startTime === assignment.startTime && 
        a.endTime === assignment.endTime &&
        a.pharmacistId === currentPharmacistId
      );

      // Find all other pharmacists assigned to the same cell (same location, time, date)
      if (clickedAssignmentIndex !== -1) {
        const otherAssignments = rota.assignments.filter((a: any, index: number) => 
          index !== clickedAssignmentIndex && // Not the clicked assignment
          a.location === assignment.location && 
          a.startTime === assignment.startTime && 
          a.endTime === assignment.endTime
        );

        otherPharmacistIds = otherAssignments.map((a: any) => a.pharmacistId);
      }
    } 
  
    // If we couldn't find in allRotas or clickedAssignmentIndex is -1, try rotaAssignments (edit mode)
    if (clickedAssignmentIndex === -1) {
      // Find other pharmacists assigned to the same cell from rotaAssignments
      const sameSlotAssignments = rotaAssignments.filter(a => 
        a.date === assignmentDate &&
        a.location === assignment.location && 
        ((a.startTime === assignment.startTime && a.endTime === assignment.endTime) ||
         (a.start === assignment.start && a.end === assignment.end))
      );
      
      // Set a dummy index for edit mode
      clickedAssignmentIndex = 0;
      
      // Get other pharmacist IDs excluding the current one
      otherPharmacistIds = sameSlotAssignments
        .filter(a => a.pharmacistId !== currentPharmacistId)
        .map(a => a.pharmacistId);
    }
    
    console.log(`[handleCellClick] Selected pharmacist ${currentPharmacistId}`);
    console.log(`[handleCellClick] Other pharmacists in this cell: ${otherPharmacistIds.length > 0 ? otherPharmacistIds.join(', ') : 'none'}`);

    // Store both the selected pharmacist and other pharmacists in the cell
    setSelectedCell({ 
      rotaId,
      assignmentIndices: [clickedAssignmentIndex],
      currentPharmacistId,
      location: assignment.location,
      date: assignmentDate,
      startTime: cellStartTime || assignment.startTime,
      endTime: cellEndTime || assignment.endTime,
      otherPharmacistIds // Keep track of other pharmacists in the same cell
    });
    setShowPharmacistSelection(true);
  };

  const handlePharmacistSelect = async (pharmacistId: Id<"pharmacists">, scope: "slot" | "day" | "week") => {
  if (!selectedCell) {
    console.error("[handlePharmacistSelect] No cell selected");
    return;
  }
  
  const newAssignment = selectedCell.newAssignment;
  console.log(`[handlePharmacistSelect] Started. Scope: ${scope}, PharmacistID: ${pharmacistId}, Location: ${selectedCell.location}, Date: ${selectedCell.date}, Start: ${selectedCell.startTime}, End: ${selectedCell.endTime}`);

  // Determine what kind of cell we're editing based on location and type
  const isUnavailable = selectedCell.location === "Unavailable Pharmacists";
  const isManagement = selectedCell.location === "Management Time";
  let isDispensary = false;
  let isClinic = false;
  
  if (newAssignment) {
    isDispensary = newAssignment.type === "dispensary";
    isClinic = newAssignment.type === "clinic";
  }
  
  console.log(`[handlePharmacistSelect] Cell category: ` +
    `${isUnavailable ? 'Unavailable' : ''}` +
    `${isManagement ? 'Management' : ''}` +
    `${isDispensary ? 'Dispensary' : ''}` +
    `${isClinic ? 'Clinic' : ''}`);

  // Log information about other pharmacists in the cell
  if (selectedCell.otherPharmacistIds && selectedCell.otherPharmacistIds.length > 0) {
    console.log(`[handlePharmacistSelect] Will preserve ${selectedCell.otherPharmacistIds.length} other pharmacist(s) in this cell:`, 
      selectedCell.otherPharmacistIds.map(id => ({ id, name: getPharmacistName(id) }))
    );
  }

  try {
    // Determine if this is a ward (which uses full-day assignments)
    const isWard = selectedCell.location.includes("Ward") || 
                   selectedCell.location.includes("ITU") || 
                   selectedCell.location.includes("Emergency Assessment Unit");

    if (newAssignment) {
      console.log("[handlePharmacistSelect] Handling new assignment creation.");
      
      // Handle specific cell types with appropriate assignment types
      if (isUnavailable) {
        console.log("[handlePharmacistSelect] Updating assignment for Unavailable row");
        // Make sure we're using the right location for unavailable assignments
        newAssignment.location = "Unavailable Pharmacists";
      } else if (isManagement) {
        console.log("[handlePharmacistSelect] Updating assignment for Management Time row");
        // Make sure management time assignments are properly marked
        newAssignment.location = "Management Time";
      }
      
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
        // Get all time slots without filtering out the selected one
        const timeSlots = TIME_SLOTS.map(slot => ({
          startTime: slot.start,
          endTime: slot.end
        }));
        
        // Log the time slots for debugging
        console.log(`[handlePharmacistSelect] Using time slots:`, timeSlots.map(s => `${s.startTime}-${s.endTime}`));

        // For week scope, get all dates
        const dates = scope === "week" 
          ? Object.keys(rotaIdsByDate)
          : [selectedCell.date];
          
        // Log the dates for debugging
        console.log(`[handlePharmacistSelect] Using dates:`, dates);
        
        // Keep track of dates/slots we've already created assignments for
        // to avoid duplicating the initial assignment
        const initialDate = selectedCell.date;
        const initialStartTime = newAssignment.startTime;
        const initialEndTime = newAssignment.endTime;

        // Create assignments for each time slot and date
        for (const date of dates) {
          const rotaId = rotaIdsByDate[date];
          if (!rotaId) {
            console.warn(`[handlePharmacistSelect] No rota found for date: ${date}`);
            continue;
          }

          for (const slot of timeSlots) {
            // Skip the initial slot only on the initial date (to avoid duplication)
            // but include it on other dates
            if (date === initialDate && 
                slot.startTime === initialStartTime && 
                slot.endTime === initialEndTime) {
              console.log(`[handlePharmacistSelect] Skipping initial slot on initial date: ${date} ${slot.startTime}-${slot.endTime}`);
              continue;
            }
            
            await updateAssignment({
              rotaId,
              assignmentIndex: -1, // Create new
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
      
      if (scope === "slot") {
        console.log("[handlePharmacistSelect] Handling slot scope");
        
        if (!selectedCell.startTime || !selectedCell.endTime) {
          console.error("[handlePharmacistSelect] Missing startTime or endTime for slot scope");
          return;
        }
        
        // Get any existing assignments for this slot - same handling for all wards
        const assignmentsToUpdate = getAssignmentsForScope(
          selectedCell.location, 
          selectedCell.date, 
          "slot",
          selectedCell.startTime,
          selectedCell.endTime,
          selectedCell.currentPharmacistId
        );
        
        if (assignmentsToUpdate.length > 0 && assignmentsToUpdate[0].indices.length > 0) {
          // We found an existing assignment for this slot - update it
          const { rotaId, indices } = assignmentsToUpdate[0];
          console.log(`[handlePharmacistSelect] Updating existing assignment at index ${indices[0]}`);
          
          // 1. Update the specific clicked assignment
          await updateAssignment({
            rotaId,
            assignmentIndex: indices[0],
            pharmacistId,
            newAssignment: {
              location: selectedCell.location,
              type: "ward",
              startTime: selectedCell.startTime,
              endTime: selectedCell.endTime
            }
          });
          
          // 2. If there were other pharmacists in this cell that we need to preserve,
          // make sure they still have assignments
          if (selectedCell.otherPharmacistIds && selectedCell.otherPharmacistIds.length > 0) {
            console.log(`[handlePharmacistSelect] Preserving ${selectedCell.otherPharmacistIds.length} other pharmacist assignments in this cell`);
            
            // Check if each pharmacist already has an assignment for this slot
            for (const otherId of selectedCell.otherPharmacistIds) {
              const hasExistingAssignment = rotaAssignments.some(a => 
                a.pharmacistId === otherId &&
                a.location === selectedCell.location &&
                a.date === selectedCell.date &&
                a.startTime === selectedCell.startTime &&
                a.endTime === selectedCell.endTime
              );
              
              // Only create a new assignment if one doesn't already exist
              if (!hasExistingAssignment) {
                console.log(`[handlePharmacistSelect] Creating missing assignment for ${getPharmacistName(otherId)}`);
                
                await updateAssignment({
                  rotaId,
                  assignmentIndex: -1, // Create new
                  pharmacistId: otherId,
                  newAssignment: {
                    location: selectedCell.location,
                    type: "ward",
                    startTime: selectedCell.startTime,
                    endTime: selectedCell.endTime
                  }
                });
              }
            }
          }
        } else {
          // No existing assignment found - create a new one
          console.log("[handlePharmacistSelect] No existing assignment found. Creating new one.");
          
          // 1. Create assignment for the selected pharmacist
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
          
          // 2. Ensure all other pharmacists have assignments in this cell
          if (selectedCell.otherPharmacistIds && selectedCell.otherPharmacistIds.length > 0) {
            console.log(`[handlePharmacistSelect] Preserving ${selectedCell.otherPharmacistIds.length} other pharmacist assignments in this cell`);
            
            for (const otherId of selectedCell.otherPharmacistIds) {
              console.log(`[handlePharmacistSelect] Creating assignment for ${getPharmacistName(otherId)}`);
              
              await updateAssignment({
                rotaId: selectedCell.rotaId,
                assignmentIndex: -1, // Create new
                pharmacistId: otherId,
                newAssignment: {
                  location: selectedCell.location,
                  type: "ward",
                  startTime: selectedCell.startTime,
                  endTime: selectedCell.endTime
                }
              });
            }
          }
        }
      } else {
        // For day or week scope
        console.log(`[handlePharmacistSelect] Handling ${scope} scope for ward`);
        
        const assignmentsToUpdate = getAssignmentsForScope(
          selectedCell.location, 
          selectedCell.date, 
          scope,
          selectedCell.startTime,
          selectedCell.endTime,
          selectedCell.currentPharmacistId
        );
        
        console.log(`[handlePharmacistSelect] Found ${assignmentsToUpdate.length} assignments to update`);
        
        if (assignmentsToUpdate.length === 0) {
          console.warn("[handlePharmacistSelect] No assignments found to update for the selected scope and details.");
          return;
        }
        
        // Update each assignment
        for (const { rotaId, indices } of assignmentsToUpdate) {
          console.log(`[handlePharmacistSelect] Updating ${indices.length} assignments for rota ${rotaId}`);
          for (const idx of indices) {
            await updateAssignment({
              rotaId,
              assignmentIndex: idx,
              pharmacistId
            });
          }
        }
      }
      console.log("[handlePharmacistSelect] Finished updating assignments.");
    }

    // Refresh the local state to show the updated assignments
    console.log("[handlePharmacistSelect] Refreshing local rotaAssignments state.");
    
    // Refresh the local state with the latest data from allRotas
    // This is more reliable than trying to manually track which assignments were updated
    const refreshedAssignments = allRotas.flatMap((r: any) => 
      r.assignments.map((a: any) => ({ ...a, date: r.date }))
    );
    setRotaAssignments(refreshedAssignments);
    console.log(`[handlePharmacistSelect] Local state refreshed with ${refreshedAssignments.length} assignments.`);
    
    // If in edit mode of published rota and we have a callback, notify parent about changes
    if (!isViewOnly && onEditsChanged) {
      // Create a record of what changed for the parent component
      const assignmentUpdate = {
        rotaId: selectedCell.rotaId,
        assignmentIndex: selectedCell.assignmentIndices[0] ?? -1,
        pharmacistId,
        newAssignment: selectedCell.newAssignment
      };
      onEditsChanged({ assignments: [assignmentUpdate] });
    }
    
    console.log('[handlePharmacistSelect] Edit completed');
  } catch (error) {
    console.error('[handlePharmacistSelect] Failed to update assignment:', error);
  } finally {
    // Close the modal and clear selection
    setShowPharmacistSelection(false);
    setSelectedCell(null);
    console.log("[handlePharmacistSelect] Modal closed and selection cleared.");
  }
};

  return (
    <div className="mt-4 w-full" style={{ padding: 0, margin: 0, boxSizing: 'border-box' }}>
      <div className="flex gap-4 mt-6 mx-4">
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
          <h3 className="font-medium mt-6 mb-2">Select Weekdays to Include in Rota</h3>
          <p className="text-sm text-gray-600 mb-2">Deselect days for bank holidays or other special circumstances.</p>
          <div className="flex flex-wrap gap-3 mb-4">
            {CLINIC_DAY_LABELS.map((day) => {
              // Check if this weekday has any bank holidays during the selected week
              const dayIndex = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(day);
              const hasHoliday = selectedMonday && bankHolidays.some(h => {
                const holidayDate = new Date(h.date);
                return holidayDate.getDay() === dayIndex;
              });
              
              // Get the holiday name if available
              const holidayInfo = hasHoliday ? bankHolidays.find(h => {
                const holidayDate = new Date(h.date);
                return holidayDate.getDay() === dayIndex;
              }) : null;
              
              return (
                <button
                  key={day}
                  type="button"
                  className={`px-3 py-1 rounded-full border text-sm font-medium transition-colors ${
                    selectedWeekdays.includes(day)
                      ? "bg-green-100 text-green-800 border-green-300"
                      : hasHoliday
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-gray-100 text-gray-500 border-gray-300"
                  }`}
                  onClick={() => {
                    setSelectedWeekdays(prev => {
                      if (prev.includes(day)) {
                        return prev.filter(d => d !== day);
                      } else {
                        return [...prev, day];
                      }
                    });
                  }}
                  title={holidayInfo ? `Bank Holiday: ${holidayInfo.title}` : ""}
                >
                  {day}
                  {selectedWeekdays.includes(day) ? " ✓" : " ✗"}
                  {hasHoliday && (
                    <span className="ml-1 text-xs text-red-600">
                      (Holiday: {holidayInfo?.title})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            className="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedClinicIds.length === 0 || selectedWeekdays.length === 0}
            onClick={() => {
              setShowClinicSelection(false);
              setShowPharmacistSelection(true);
            }}
          >
            Confirm Clinics & Weekdays
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
                              setPharmacistWorkingDays(newObj);
                            }
                            return [...ids, pharmacist._id];
                          }
                          if (!checked) {
                            const newObj = { ...pharmacistWorkingDays };
                            delete newObj[pharmacist._id];
                            setPharmacistWorkingDays(newObj);
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
                    <div className="flex flex-wrap gap-2 items-center mb-2">
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-xs whitespace-nowrap mr-1">Working Days:</span>
                        {CLINIC_DAY_LABELS.map((day: string) => (
                          <label key={day} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={pharmacistWorkingDays[pharmacist._id]?.includes(day) || false}
                              onChange={e => {
                                setPharmacistWorkingDays(prev => {
                                  const currentDays = prev[pharmacist._id] || [];
                                  const newDays = e.target.checked 
                                    ? [...currentDays, day] 
                                    : currentDays.filter(d => d !== day);
                                  return { ...prev, [pharmacist._id]: newDays };
                                });
                              }}
                            />
                            <span className="text-xs">{day}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="font-semibold text-xs whitespace-nowrap">Protected Rota Time:</span>
                        <ul className="flex flex-wrap gap-2 mb-0">
                          {/* Show permanent rules with toggle option */}
                          {(pharmacist.notAvailableRules || []).map((rule: {dayOfWeek: string, startTime: string, endTime: string}, idx: number) => {
                            const ignored = (ignoredUnavailableRules[pharmacist._id] || []).includes(idx);
                            return (
                              <li key={`perm-${idx}`} 
                                  className={`flex items-center gap-1 text-xs rounded px-1 ${ignored ? 'bg-gray-200 text-gray-500' : 'bg-red-50'}`}>
                                <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                                {/* Toggle button - only action for permanent rules */}
                                <button
                                  type="button"
                                  className={`text-xs ml-1 ${ignored ? 'text-green-500' : 'text-orange-500'}`}
                                  title={ignored ? 'Enable this rule' : 'Disable this rule'}
                                  onClick={() => toggleUnavailableRule(pharmacist._id, idx, !ignored)}
                                >
                                  {ignored ? '⟲' : '⏸'}
                                </button>
                              </li>
                            );
                          })}
                          
                          {/* Show ad-hoc rules */}
                          {(rotaUnavailableRules[pharmacist._id] || []).map((rule: {dayOfWeek: string, startTime: string, endTime: string}, idx: number) => (
                            <li key={`adhoc-${idx}`} className="flex items-center gap-1 text-xs bg-orange-50 rounded px-1">
                              <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                              <button
                                type="button"
                                className="text-red-500 text-xs ml-1"
                                title="Delete this rule"
                                onClick={() => removeRotaUnavailableRule(pharmacist._id, idx)}
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
                placeholder="Search pharmacists..."
                className="border rounded px-2 py-1 w-64"
                value={pharmacistSearch}
                onChange={e => setPharmacistSearch(e.target.value)}
              />
            </div>
            {/* Non-default pharmacists, always shown and filtered by search */}
            {(
              <div className="border rounded p-4 mb-4 bg-gray-50">
                <h4 className="font-medium mb-2">Search Results</h4>
                {[...pharmacists]
                  .filter((p: any) => 
                    // Only show non-default pharmacists that aren't already selected
                    !p.isDefaultPharmacist &&
                    !selectedPharmacistIds.includes(p._id) &&
                    // Filter by search text if provided
                    (pharmacistSearch === '' || p.name.toLowerCase().includes(pharmacistSearch.toLowerCase()))
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
                                  
                                  setPharmacistWorkingDays(newObj);
                                }}
                                disabled={effectiveViewOnly}
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
                            disabled={isViewOnly}
                          >
                            Add to Rota
                          </button>
                        </div>
                      </div>
                    );
                  })}
                {[...pharmacists]
                  .filter((p: any) => 
                    !p.isDefaultPharmacist &&
                    !selectedPharmacistIds.includes(p._id) &&
                    (pharmacistSearch === '' || p.name.toLowerCase().includes(pharmacistSearch.toLowerCase()))
                  ).length === 0 && (
                  <div className="text-gray-500 italic">No non-default pharmacists available</div>
                )}
              </div>
            )}
          </div>
          <button
            className="mt-4 bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedPharmacistIds.length === 0 || effectiveViewOnly}
            onClick={() => {
              setShowPharmacistSelection(false);
              handleGenerateWeeklyRota();
            }}
          >
            Confirm Pharmacists
          </button>
        </div>
      )}
      {(rotaGenerated || (rotaAssignments.length > 0 && selectedMonday)) && (
        <div className="mt-10" style={{ width: '100%', margin: 0, padding: 0 }}>
          <div className="flex justify-between items-center mb-4 mx-4">
            <h3 className="text-xl font-bold">Weekly Rota Table</h3>
            <div className="flex items-center space-x-2">
              {publishSuccess && (
                <span className="text-green-600 text-sm bg-green-100 px-2 py-1 rounded mr-2">
                  Rota published successfully!
                </span>
              )}
              
              {/* Download PDF button - only show when viewing a published rota */}
              {(effectiveViewOnly || publishedRota) && (
                <button
                  onClick={handleDownloadPDF}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded flex items-center mr-2"
                  title="Download PDF of rota"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  Download PDF
                </button>
              )}
              
              <div className="flex space-x-2">
                <button
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50 flex items-center"
                  onClick={handleReset}
                  disabled={isViewOnly}
                  title="Reset to original rota"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                  Reset
                </button>
                
                <button
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  onClick={addEauRow}
                  disabled={isViewOnly}
                  title="Add an additional EAU pharmacist row"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Add EAU Row
                </button>
                
                {/* Only show the Publish Rota button when not editing an already published rota */}
                {!publishedRota && (
                  <button
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 flex items-center"
                    onClick={handlePublishRota}
                    disabled={isPublishing || effectiveViewOnly}
                  >
                    {isPublishing ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Publishing...
                      </>
                    ) : "Publish Rota"}
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Dispensary Mode Toggles */}
          <div className="mb-4 mx-4">
            {selectedMonday && [0,1,2,3,4].map((dayOffset: number) => {
              // Ensure selectedMonday is valid before creating date objects
              const date = new Date(selectedMonday);
              if (isNaN(date.getTime())) return null; // Skip if date is invalid
              
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
          
          <div style={{ width: 'calc(100vw - 8px)', maxWidth: 'calc(100vw - 8px)', overflow: 'auto', position: 'relative' as const, left: '50%', right: '50%', marginLeft: 'calc(-50vw + 4px)', marginRight: 'calc(-50vw + 4px)' }}>
            <table className="w-full border border-gray-300 mb-4 rota-table" style={{ tableLayout: 'fixed' }}>
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
                      <th key={dayOffset} colSpan={TIME_SLOTS.length} className="border p-2 bg-gray-100 text-xs border-b border-gray-200" style={{ borderBottomWidth: 1 }}>
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
                        className="border p-2 bg-blue-50 text-xs"
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        {slot.start}-{slot.end}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>


  {allWards.flatMap((ward: any, idx: number, arr: any[]): React.ReactNode[] => {
    // Log each ward name to debug EAU detection
    console.log(`Ward ${idx}: ${ward.name} (${ward.directorate})`);
    
    // Check if this is the last ward in a directorate
    const isLastInDirectorate = idx < arr.length - 1 && ward.directorate !== arr[idx + 1].directorate;
    
    // Apply directorate separator style
    // Use box-shadow instead of border for directorate separators to make it hang under the cell for PDF output
    const rowStyle = isLastInDirectorate 
      ? { 
          borderBottom: '1px solid #e5e7eb', 
          boxShadow: 'inset 0 -4px 0 -1px #9ca3af', // This makes the border hang below the cell
          position: 'relative' as const,
          zIndex: 1
        } 
      : { borderBottom: '1px solid #e5e7eb' };
    
    // Check if this is the EAU ward - use very explicit detection to catch all possible forms
    const isEAU = ward.name === "EAU" || 
                  ward.name === "Emergency Assessment Unit" ||
                  ward.name.includes("EAU") || 
                  ward.name.includes("Emergency") ||
                  ward.name.includes("Assessment") ||
                  ward.directorate.includes("Emergency");
    
    // Log if we identified an EAU ward
    if (isEAU) {
      console.log(`EAU ward detected: ${ward.name}`);
    }
    
    // Create an array to hold both the regular ward row and potentially the "Add New" row
    const rows = [];
    
    // Add the regular ward row
    rows.push(
      <tr key={ward.directorate + ward.name} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
        <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>{ward.directorate}</td>
        <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={rowStyle}>
          {ward.name}
          {isEAU && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                addEauRow();
                console.log("Adding EAU row");
              }} 
              className="ml-2 inline-flex items-center justify-center rounded bg-blue-500 text-white px-2 py-0.5 text-xs font-bold hover:bg-blue-600 focus:outline-none"
              title="Add additional EAU pharmacist row"
            >
              + Add
            </button>
          )}
        </td>
        {[...Array(5)].flatMap((_, dayOffset: number) => {
          const date = new Date(selectedMonday);
          date.setDate(date.getDate() + dayOffset);
          const isoDate = date.toISOString().split('T')[0];
          return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
            // Check if this day is deselected in the current rota generation
            const dayDate = new Date(date);
            const isDeselected = isDeselectedDay(dayDate);
            
            // Get assignments specifically for this date
            const assignmentsForDate = rotaAssignments.filter(a => a.date === isoDate);
            // Determine the assignments to display in this cell using the standardized logic
            const displayAssignments = getAssignmentsForCell(ward.name, isoDate, slot.start, slot.end, assignmentsForDate);
            // For backward compatibility with existing code
            const displayAssignment = displayAssignments.length > 0 ? displayAssignments[0] : null;

            return (
              <td
                key={isoDate + slot.start + slot.end + ward.name}
                className={`border ${displayAssignments.length > 0 ? 'p-0' : 'p-1'} text-center truncate max-w-[70px] text-xs align-middle whitespace-normal ${displayAssignments.length === 0 ? 'cursor-pointer hover:bg-gray-100' : ''} ${!effectiveViewOnly && displayAssignments.length > 0 ? 'rota-drag-cell' : ''} ${isDeselected ? 'bg-gray-200' : ''}`}
                style={{ 
                  ...rowStyle, 
                  // No special border for last slot 
                  height: '2.5em', 
                  minHeight: '2.5em', 
                  lineHeight: '1.2', 
                  whiteSpace: 'normal', 
                  wordBreak: 'break-word', 
                  overflow: 'hidden',
                  ...(isDeselected ? { position: 'relative' as const, pointerEvents: 'none' as const, opacity: '0.7' } : {})
                }}
                onClick={() => !isDeselected && displayAssignments.length === 0 && handleEmptyCellClick(ward.name, "ward", isoDate, slot.start, slot.end)}
                onDragOver={(e) => !isDeselected && displayAssignments.length > 0 && handleDragOver(e, displayAssignments[0].pharmacistId, displayAssignments[0], ward.name, isoDate, slot.start, slot.end)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-pharmacist-id={displayAssignments.length > 0 ? displayAssignments.map(a => a.pharmacistId).join(',') : ''}
                data-location={ward.name}
                data-date={isoDate}
                data-start-time={slot.start}
                data-end-time={slot.end}
                data-deselected={isDeselected ? 'true' : 'false'}
              >
                {isDeselected ? (
                  <div className="absolute top-0 left-0 flex items-center justify-center h-full w-full bg-gray-300 z-10" style={{ opacity: 0.95 }}>
                    <span className="text-gray-700 font-medium text-xs">Not Selected</span>
                  </div>
                ) : null}
                
                {/* Only render assignments if not deselected or to keep DOM consistent but hidden */}
                {displayAssignments.length > 0 ? (
                  <div className="flex flex-col w-full h-full">
                    {displayAssignments.map((assignment, index) => (
                      <div 
                        key={`${assignment.pharmacistId}-${index}`}
                        className={`${getPharmacistCellClass(assignment.pharmacistId)} w-full p-1 flex items-center justify-center ${!isViewOnly ? 'cursor-grab' : ''}`}
                        style={{
                          height: `${100 / displayAssignments.length}%`, 
                          borderTop: index > 0 ? '1px solid rgba(0,0,0,0.1)' : 'none'
                        }}
                        draggable={!isViewOnly}
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent cell click from triggering
                          handleCellClick(assignment, assignment.pharmacistId, slot.start, slot.end);
                        }}
                        onDragStart={(e) => handleDragStart(e, assignment.pharmacistId, assignment, ward.name, isoDate, slot.start, slot.end)}
                        onDragEnd={handleDragEnd}
                      >
                        <span className={`text-center w-full ${hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}`}>
                          {getPharmacistName(assignment.pharmacistId)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : ''}
              </td>
            );
          });
        })}
      </tr>
    );
    

    // If this is the EAU ward, add any dynamically created additional rows
    if (isEAU && eauAdditionalRows.length > 0) {
      // Add each additional EAU row
      eauAdditionalRows.forEach((rowNum) => {
        rows.push(
          <tr key={ward.directorate + ward.name + "-additional-" + rowNum} className="bg-blue-50">
            <td className="border p-2 font-semibold sticky left-0 bg-blue-50 z-10 truncate max-w-[120px]" style={rowStyle}></td>
            <td className="border p-2 sticky left-0 bg-blue-50 z-10 truncate max-w-[120px]" style={rowStyle}>
              EAU {rowNum}
            </td>
            {[...Array(5)].flatMap((_, dayOffset: number) => {
              const date = new Date(selectedMonday);
              date.setDate(date.getDate() + dayOffset);
              const isoDate = date.toISOString().split('T')[0];
              return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                // Check if this day is deselected in the current rota generation
                const dayDate = new Date(date);
                const isDeselected = isDeselectedDay(dayDate);
                
                // Get assignments specifically for this date and row
                const rowName = `${ward.name} Additional ${rowNum}`;
                const assignmentsForDate = rotaAssignments.filter(a => a.date === isoDate && a.location === rowName);
                const displayAssignments = getAssignmentsForCell(rowName, isoDate, slot.start, slot.end, assignmentsForDate);
                
                return (
                  <td
                    key={isoDate + slot.start + slot.end + rowName}
                    className={`border ${displayAssignments.length > 0 ? 'p-0' : 'p-1'} text-center truncate max-w-[70px] text-xs align-middle whitespace-normal${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${displayAssignments.length === 0 ? 'cursor-pointer hover:bg-blue-100' : ''} ${!effectiveViewOnly && displayAssignments.length > 0 ? 'rota-drag-cell' : ''} ${isDeselected ? 'not-selected-cell' : ''}`}
                    style={{ ...rowStyle, borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'hidden' }}
                    onClick={() => displayAssignments.length === 0 && handleEmptyCellClick(rowName, "ward", isoDate, slot.start, slot.end)}
                    onDragOver={(e) => displayAssignments.length > 0 && handleDragOver(e, displayAssignments[0].pharmacistId, displayAssignments[0], rowName, isoDate, slot.start, slot.end)}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    data-pharmacist-id={displayAssignments.length > 0 ? displayAssignments.map(a => a.pharmacistId).join(',') : ''}
                    data-location={rowName}
                    data-date={isoDate}
                    data-start-time={slot.start}
                    data-end-time={slot.end}
                    data-deselected={isDeselected ? 'true' : 'false'}
                  >
                    {isDeselected ? (
                      <div className="flex items-center justify-center h-full w-full bg-gray-200">
                        <span className="text-gray-500 font-medium text-xs">Not Selected</span>
                      </div>
                    ) : displayAssignments.length > 0 ? (
                      <div className="flex flex-col w-full h-full">
                        {displayAssignments.map((assignment, index) => (
                          <div 
                            key={`${assignment.pharmacistId}-${index}`}
                            className={`${getPharmacistCellClass(assignment.pharmacistId)} w-full p-1 flex items-center justify-center ${!effectiveViewOnly ? 'cursor-grab' : ''}`}
                            style={{ height: `${100 / displayAssignments.length}%`, borderTop: index > 0 ? '1px solid rgba(0,0,0,0.1)' : 'none' }}
                            draggable={!effectiveViewOnly}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCellClick(assignment, assignment.pharmacistId, slot.start, slot.end);
                            }}
                            onDragStart={(e) => handleDragStart(e, assignment.pharmacistId, assignment, rowName, isoDate, slot.start, slot.end)}
                            onDragEnd={handleDragEnd}
                          >
                            <span className={`text-center w-full ${hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}`}>
                              {getPharmacistName(assignment.pharmacistId)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-blue-700">+</span>
                    )}
                  </td>
                );
              });
            })}
          </tr>
        );
      });
    }
    
    return rows;
  })}                

  {/* --- Dispensary --- */}
  <tr>
    <td className="p-2 font-semibold sticky left-0 bg-white z-10" colSpan={2} style={{ border: '1px solid #e5e7eb' }}>Dispensary</td>
    {[0,1,2,3,4].flatMap((dayOffset: number) => {
      const date = new Date(selectedMonday);
      date.setDate(date.getDate() + dayOffset);
      const isoDate = date.toISOString().split('T')[0];
      // Check if this day is deselected in the current rota generation
      const dayDate = new Date(date);
      const isDeselected = isDeselectedDay(dayDate);
      
      return TIME_SLOTS.map((slot, slotIdx) => {
        const assignment = getDispensaryAssignment(isoDate, slot);
        let displayName = '';
        let isLunch = false;
        if (assignment) {
          displayName = getPharmacistName(assignment.pharmacistId);
          // Check if this is a lunch cover assignment, regardless of time slot
          if (assignment.isLunchCover) {
            isLunch = true;
          }
        }
        return (
          <td
            key={dayOffset + '-' + slotIdx}
            className={`p-1 text-xs bg-gray-50 font-semibold ${assignment ? getPharmacistCellClass(assignment.pharmacistId) : 'cursor-pointer hover:bg-gray-100'} ${isDeselected ? 'bg-gray-200 not-selected-cell' : ''}`}
            style={{ 
              borderTop: 'none',
              borderBottom: 'none',
              height: '2.5em', 
              minHeight: '2.5em', 
              lineHeight: '1.2', 
              whiteSpace: 'normal', 
              wordBreak: 'break-word'
            }}
            onClick={(event) => {
              if (isDeselected) return;
              const cellKey = `dispensary-${isoDate}-${slot.start}-${slot.end}`;
              const currentText = freeCellText[cellKey] || (displayName ? displayName + (isLunch ? " (lunch cover)" : "") : "");
              createCellTextInput(event.currentTarget as HTMLElement, cellKey, currentText, '#f9fafb'); // Light gray background
            }}
          >
            {(() => {
              // Show "Not Selected" if the day is deselected
              if (isDeselected) {
                return <NotSelectedOverlay />;
              }
              
              // Show either the free text or the pharmacist name
              const cellKey = `dispensary-${isoDate}-${slot.start}-${slot.end}`;
              const defaultText = displayName ? (
                <div className="text-center">
                  <span className={assignment && hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : 'text-black font-bold'}>
                    {displayName}{isLunch && " (lunch cover)"}
                  </span>
                </div>
              ) : null;
              
              return freeCellText[cellKey] ? (
                <div className="text-center">
                  <span>{freeCellText[cellKey]}</span>
                </div>
              ) : defaultText;
            })()}
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
    
    return (
      <tr key={clinic._id}>
        <td className="p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ border: '1px solid #e5e7eb' }}>{clinicLabel}</td>
        <td className="p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ border: '1px solid #e5e7eb' }}>{clinic.name}</td>
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
            
            // Check if this day is deselected in the current rota generation
            const dayDate = new Date(date);
            const isDeselected = isDeselectedDay(dayDate);
            
            if (isClinicDay && overlaps) {
              // Get clinic assignment for this date
              const assignment = getClinicAssignment(isoDate, clinic.name);
              return (
                <td
                   key={isoDate + slot.start + slot.end + clinic._id}
                   className={`p-1 text-center truncate max-w-[70px] text-xs align-middle ${isDeselected ? 'bg-gray-200' : ''}`}
                   style={{ 
                     border: 'none',
                     backgroundColor: isDeselected ? '#e5e7eb' : (assignment ? '#fef9c3' : '#fef9c3'), 
                     color: '#000', 
                    ...(isDeselected ? { position: 'relative' as const, pointerEvents: 'none' as const, opacity: '0.7' } : {})
                  }}
                  onClick={(event) => {
                    if (isDeselected) return;
                    const cellKey = `clinic-${clinic.name}-${isoDate}-${slot.start}-${slot.end}`;
                    const currentText = freeCellText[cellKey] || (assignment ? getPharmacistName(assignment.pharmacistId) : "");
                    createCellTextInput(event.currentTarget as HTMLElement, cellKey, currentText, '#fef9c3'); // Yellow background
                  }}
                >
                  {(() => {
                    // Show "Not Selected" if the day is deselected
                    if (isDeselected) {
                      return <NotSelectedOverlay />;
                    }
                    
                    // Show either the free text or the clinic assignment
                    const cellKey = `clinic-${clinic.name}-${isoDate}-${slot.start}-${slot.end}`;
                    if (freeCellText[cellKey]) {
                      return <span>{freeCellText[cellKey]}</span>;
                    }
                    
                    return assignment ? (
                      <span className={hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : 'text-black font-bold'}>
                        {getPharmacistName(assignment.pharmacistId)}
                      </span>
                    ) : "";
                  })()}
                </td>
              );
            } else {
              return <td key={isoDate + slot.start + slot.end + clinic._id} className="p-1 text-center max-w-[70px] text-xs bg-gray-50" style={{ border: '1px solid #e5e7eb' }}></td>;
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
                  <td colSpan={2} className="p-2 font-semibold bg-red-50 text-red-700 sticky left-0 z-10" style={{ border: '1px solid #e5e7eb' }}>Unavailable</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      // Check if this day is deselected in the current rota generation
                      const dayDate = new Date(date);
                      const isDeselected = isDeselectedDay(dayDate);
                      
                      // Find unavailable pharmacists for this date/slot
                      const unavailable = rotaAssignments.filter(a => 
                        a.type === "unavailable" && 
                        a.date === isoDate && 
                        a.location === "Unavailable Pharmacists" &&
                        ((a.startTime <= slot.start && a.endTime > slot.start) || 
                         (a.startTime < slot.end && a.endTime >= slot.end) ||
                         (a.startTime >= slot.start && a.endTime <= slot.end))
                      ).map(a => {
                        const pharmacist = pharmacists.find((p: any) => p._id === a.pharmacistId);
                        return pharmacist || { name: "Unknown" };
                      });
                      
                      // Also get pharmacists with protected rota time for this date/slot
                      const protectedTimePharmacists = getProtectedRotaTimePharmacists(isoDate, slot);
                      
                      // Combine both lists
                      const allUnavailablePharmacists = [
                        ...unavailable,
                        ...protectedTimePharmacists
                      ];
                      
                      return (
                        <td 
                           key={dayOffset + '-' + slotIdx} 
                           className={`p-1 text-xs bg-red-50 text-red-700 text-center${!effectiveViewOnly && !isDeselected ? ' cursor-pointer hover:bg-red-100' : ''} ${isDeselected ? 'bg-gray-200 not-selected-cell' : ''}`}
                           style={{ 
                             borderTop: 'none',
                             borderBottom: 'none', 
                           }}
                          onClick={(event) => {
                            if (isDeselected) return;
                            const cellKey = `unavailable-${isoDate}-${slot.start}-${slot.end}`;
                            const currentText = freeCellText[cellKey] || allUnavailablePharmacists.map((p: any) => p.name || p.displayName || 'Unknown').join(', ');
                            createCellTextInput(event.currentTarget as HTMLElement, cellKey, currentText, '#fee2e2'); // Light red background
                          }}
                        >
                          {(() => {
                            if (isDeselected) {
                              return (
                                <div className="flex items-center justify-center h-full w-full">
                                  <span className="text-gray-500 font-medium text-xs">Not Selected</span>
                                </div>
                              );
                            }
                            // Show either the free text or the unavailable pharmacist names
                            const cellKey = `unavailable-${isoDate}-${slot.start}-${slot.end}`;
                            const defaultText = allUnavailablePharmacists.map((p: any) => p.name || p.displayName || 'Unknown').join(', ');
                            return freeCellText[cellKey] || defaultText || '';
                          })()}
                        </td>
                      );
                    });
                  })}
                </tr>
                {/* --- Management Time --- */}
                <tr>
                  <td colSpan={2} className="p-2 font-semibold bg-blue-100 z-10 truncate max-w-[120px]" style={{ border: '1px solid #e5e7eb' }}>Management Time</td>
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
                                            // Check if this day is deselected in the current rota generation
                       const dayDate = new Date(date);
                       const isDeselected = isDeselectedDay(dayDate);
                       
                       return (
                        <td
                           key={isoDate + slot.start + slot.end + 'management'}
                           className={`p-1 text-center max-w-[70px] text-xs bg-blue-50 ${!effectiveViewOnly && !isDeselected ? 'cursor-pointer hover:bg-blue-100' : ''} ${isDeselected ? 'bg-gray-200 not-selected-cell' : ''}`} 
                           style={{ 
                             borderTop: 'none',
                             borderBottom: 'none', 
                             lineHeight: '1.2', 
                             whiteSpace: 'normal', 
                             wordBreak: 'break-word',
                             ...(isDeselected ? { position: 'relative' as const, pointerEvents: 'none' as const } : {})
                           }}
                          onClick={(event) => {
                            if (isDeselected) return;
                            const cellKey = `management-${isoDate}-${slot.start}-${slot.end}`;
                            const currentText = freeCellText[cellKey] || pharmacistNames.join(", ");
                            createCellTextInput(event.currentTarget as HTMLElement, cellKey, currentText, '#e0f2fe'); // Light blue background
                          }}
                        >
                          {(() => {
                            if (isDeselected) {
                              return (
                                <div className="flex items-center justify-center h-full w-full">
                                  <span className="text-gray-500 font-medium text-xs">Not Selected</span>
                                </div>
                              );
                            }
                            // Show either the free text or the pharmacist names
                            const cellKey = `management-${isoDate}-${slot.start}-${slot.end}`;
                            const cellText = freeCellText[cellKey] || (pharmacistNames.length > 0 ? pharmacistNames.join(", ") : "");
                            return cellText ? <span>{cellText}</span> : null;
                          })()}
                        </td>
                      );
                    });
                  })}
                </tr>
              </tfoot>
              
              {/* Add CSS for consistent borders in the PDF */}
              <style>
                {`
                  .rota-table td, .rota-table th {
                    border: 1px solid #e5e7eb;
                  }
                  .rota-table tbody tr:not(:last-child) td {
                    border-bottom: 1px solid #e5e7eb;
                  }
                  /* Style for directorate separators in PDF */
                  .rota-table tbody tr:last-child td {
                    border-bottom: 1px solid #e5e7eb;
                  }
                `}
              </style>
            </table>
          </div>
        </div>
      )}
      {/* Add the PharmacistSelectionModal - only shown when not in view-only mode */}
      {!effectiveViewOnly && showPharmacistSelection && selectedCell && (
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
