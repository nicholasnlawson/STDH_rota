import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useConvex } from "convex/react"; // Ensure useConvex is imported here
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { getBankHolidaysInRange, BankHoliday } from "./bankHolidays";

// Add type declarations for custom properties on the window object
declare global {
  interface Window {
    __rotaViewRendered?: boolean;
    __sortedSelectedClinicsLogged?: boolean;
  }
}
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
  const convex = useConvex(); // Initialize convex client at the top level
  const saveRotaConfiguration = useMutation(api.rotas.saveRotaConfiguration);
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
  const [hasExistingConfig, setHasExistingConfig] = useState(false); // New state for existing config
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
  const [selectedPharmacistForReport, setSelectedPharmacistForReport] = useState<Id<"pharmacists"> | null>(null);
  const [showPharmacistReport, setShowPharmacistReport] = useState(false);
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
  
  // Handle reset - return to previously published rota if available, or regenerate if not
  // Function to get the band priority for sorting (lower number = higher priority)
  const getBandPriority = (band: string): number => {
    switch (band) {
      case '6': return 1;
      case '7': return 2;
      case '8a': return 3;
      case '8b': return 4;
      case '8c': return 5;
      default: return 6; // Default to lowest priority for any other bands
    }
  };

  // Function to get eligible pharmacists for dispensary shifts
  const getEligibleDispensaryPharmacists = (date: string, isLunchCover: boolean = false, excludePharmacistId?: string) => {
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    return selectedPharmacistIds
      .map(id => pharmacists.find(p => p._id === id))
      .filter((p): p is NonNullable<typeof p> => {
        if (!p) return false;
        
        // Exclude if specified
        if (excludePharmacistId && p._id === excludePharmacistId) return false;
        
        // Check if pharmacist is working this day
        const workingDays = pharmacistWorkingDays[p._id] || [];
        if (!workingDays.includes(dayOfWeek)) return false;
        
        // Exclude EAU practitioners
        if (p.band === 'EAU Practitioner') return false;
        
        // For lunch cover, exclude dispensary pharmacists
        if (isLunchCover && p.band === 'Dispensary Pharmacist') return false;
        
        return true;
      })
      .sort((a, b) => {
        // Sort by band priority (junior first), then randomly within same band
        const aPriority = getBandPriority(a.band);
        const bPriority = getBandPriority(b.band);
        
        if (aPriority !== bPriority) {
          return aPriority - bPriority; // Lower number = higher priority
        }
        
        // If same band, randomize
        return Math.random() - 0.5;
      });
  };

  // Function to shuffle only dispensary shifts while preserving other assignments
  const handleShuffleDispensaryShifts = async () => {
    if (!selectedMonday) return;
    
    try {
      setGeneratingWeekly(true);
      
      // Get current assignments
      const currentAssignments = [...rotaAssignments];
      
      // Group assignments by date
      const assignmentsByDate: Record<string, any[]> = {};
      currentAssignments.forEach(assignment => {
        if (!assignmentsByDate[assignment.date]) {
          assignmentsByDate[assignment.date] = [];
        }
        assignmentsByDate[assignment.date].push(assignment);
      });

      // Process each date separately
      for (const [date, dateAssignments] of Object.entries(assignmentsByDate)) {
        // Separate dispensary and non-dispensary assignments
        const dispensaryAssignments = dateAssignments.filter(a => a.type === 'dispensary');
        const otherAssignments = dateAssignments.filter(a => a.type !== 'dispensary');

        if (dispensaryAssignments.length === 0) continue;

        // Check if there's a dispensary pharmacist assigned for this day
        const hasDispensaryPharmacist = dispensaryAssignments.some(a => {
          const pharmacist = pharmacists.find(p => p._id === a.pharmacistId);
          return pharmacist?.band === 'Dispensary Pharmacist';
        });

        // If we have a dispensary pharmacist, we only shuffle lunch cover
        if (hasDispensaryPharmacist) {
          // Find the lunch cover assignment (if any)
          const lunchCoverAssignment = dispensaryAssignments.find(
            a => a.isLunchCover || (a.startTime === '13:30' && a.endTime === '14:00')
          );

          if (lunchCoverAssignment) {
            // Get eligible pharmacists for lunch cover (exclude dispensary pharmacists)
            const eligiblePharmacists = getEligibleDispensaryPharmacists(date, true);
            
            if (eligiblePharmacists.length > 0) {
              // Get the pharmacist with the fewest dispensary duties
              const pharmacistDutyCounts = new Map<string, number>();
              eligiblePharmacists.forEach(p => {
                const count = dispensaryAssignments.filter(a => a.pharmacistId === p._id).length;
                pharmacistDutyCounts.set(p._id, count);
              });
              
              // Sort by duty count (ascending) and then by band priority
              const sortedPharmacists = [...eligiblePharmacists].sort((a, b) => {
                const aCount = pharmacistDutyCounts.get(a._id) || 0;
                const bCount = pharmacistDutyCounts.get(b._id) || 0;
                
                if (aCount !== bCount) {
                  return aCount - bCount;
                }
                
                // If same count, use band priority
                return getBandPriority(a.band) - getBandPriority(b.band);
              });
              
              // Assign the first eligible pharmacist
              lunchCoverAssignment.pharmacistId = sortedPharmacists[0]._id;
            }
          }
        } else {
          // No dispensary pharmacist - handle full day assignments
          // Group shifts by time slot
          const timeSlots = new Map<string, any[]>();
          dispensaryAssignments.forEach(assignment => {
            const key = `${assignment.startTime}-${assignment.endTime}`;
            if (!timeSlots.has(key)) {
              timeSlots.set(key, []);
            }
            timeSlots.get(key)?.push(assignment);
          });
          
          // Get all pharmacists eligible for dispensary duty
          const eligiblePharmacists = getEligibleDispensaryPharmacists(date);
          
          if (eligiblePharmacists.length === 0) continue;
          
          // Count current assignments per pharmacist
          const pharmacistAssignmentCounts = new Map<string, number>();
          eligiblePharmacists.forEach(p => {
            const count = dispensaryAssignments.filter(a => a.pharmacistId === p._id).length;
            pharmacistAssignmentCounts.set(p._id, count);
          });
          
          // Sort time slots (lunch cover last)
          const sortedTimeSlots = Array.from(timeSlots.entries()).sort(([a], [b]) => {
            const isALunch = a.includes('13:30-14:00');
            const isBLunch = b.includes('13:30-14:00');
            if (isALunch && !isBLunch) return 1;
            if (!isALunch && isBLunch) return -1;
            return 0;
          });
          
          // Process each time slot
          for (const [_, assignments] of sortedTimeSlots) {
            // Sort pharmacists by current assignment count (ascending) and band priority
            const sortedPharmacists = [...eligiblePharmacists].sort((a, b) => {
              const aCount = pharmacistAssignmentCounts.get(a._id) || 0;
              const bCount = pharmacistAssignmentCounts.get(b._id) || 0;
              
              if (aCount !== bCount) {
                return aCount - bCount;
              }
              
              // If same count, use band priority
              return getBandPriority(a.band) - getBandPriority(b.band);
            });
            
            // Assign pharmacists to this time slot
            assignments.forEach((assignment, idx) => {
              const pharmacist = sortedPharmacists[idx % sortedPharmacists.length];
              if (pharmacist) {
                assignment.pharmacistId = pharmacist._id;
                // Update assignment count
                const currentCount = pharmacistAssignmentCounts.get(pharmacist._id) || 0;
                pharmacistAssignmentCounts.set(pharmacist._id, currentCount + 1);
              }
            });
          }
        }
        
        // Update the date's assignments
        const updatedDateAssignments = [...otherAssignments, ...dispensaryAssignments];
        
        // Update the main assignments array
        const assignmentIndices = currentAssignments
          .map((a, i) => (a.date === date ? i : -1))
          .filter(i => i !== -1);
        
        assignmentIndices.forEach((idx, i) => {
          if (i < updatedDateAssignments.length) {
            currentAssignments[idx] = updatedDateAssignments[i];
          }
        });
      }
      
      // Update state with the modified assignments
      setRotaAssignments(currentAssignments);
      
      // Notify parent component of changes if needed
      if (onEditsChanged) {
        onEditsChanged({
          assignments: currentAssignments,
          freeCellText: freeCellText
        });
      }
    } catch (error) {
      console.error('Error shuffling dispensary shifts:', error);
    } finally {
      setGeneratingWeekly(false);
    }
  };

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
      
      // First, check if we're editing a published rota (in that case, use the initialRotaAssignments)
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
        // Check if there are published rotas for this week we can restore to
        // Look for published rotas in allRotas that match the selected week
        const publishedRotasForWeek = allRotas.filter((r: any) => {
          // Check if this rota is for the current week and is published
          const rotaDate = new Date(r.date);
          const rotaDateStr = rotaDate.toISOString().split('T')[0];
          const selectedDate = new Date(selectedMonday);
          const daysDiff = Math.floor((rotaDate.getTime() - selectedDate.getTime()) / (1000 * 60 * 60 * 24));
          return r.status === 'published' && daysDiff >= 0 && daysDiff < 7; // Within the selected week
        });
        
        if (publishedRotasForWeek.length > 0) {
          // If we have published rotas for this week, restore those instead of regenerating
          console.log('[handleReset] Found published rotas for this week, restoring those instead of regenerating');
          
          // Clear modifications
          setEauAdditionalRows([]);
          setIgnoredUnavailableRules({});
          setRotaUnavailableRules({});
          setFreeCellText({});
          
          // Create a map of date to rota ID and collect all assignments
          const newRotaIdsByDate: Record<string, Id<"rotas">> = {};
          const allAssignments: any[] = [];
          const allFreeCellText: Record<string, string> = {};
          
          publishedRotasForWeek.forEach((rota: any) => {
            // Add date to rota ID mapping
            const dateObj = new Date(rota.date);
            const dateStr = dateObj.toISOString().split('T')[0];
            newRotaIdsByDate[dateStr] = rota._id;
            
            // Add assignments with date field
            if (Array.isArray(rota.assignments)) {
              const assignmentsWithDate = rota.assignments.map((a: any) => ({
                ...a,
                date: dateStr
              }));
              allAssignments.push(...assignmentsWithDate);
            }
            
            // Collect free cell text
            if (rota.freeCellText && typeof rota.freeCellText === 'object') {
              Object.entries(rota.freeCellText).forEach(([key, value]) => {
                allFreeCellText[key] = value as string;
              });
            }
          });
          
          // Update state with the published rota data
          setRotaIdsByDate(newRotaIdsByDate);
          setRotaAssignments(allAssignments);
          setFreeCellText(allFreeCellText);
          
          console.log('[handleReset] Reset to published rota assignments complete');
        } else {
          // If no published rotas, fall back to regenerating completely
          console.log('[handleReset] No published rotas found for this week - regenerating rota');
          
          // Clear modifications
          setEauAdditionalRows([]);
          setIgnoredUnavailableRules({});
          setRotaUnavailableRules({});
          setFreeCellText({});
          
          // Call the API to regenerate the rota completely
          await handleGenerateWeeklyRota(undefined, true);
        }
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
    // Only log when genuinely needed
    const isInitialOrChange = rotaAssignments.length === 0 || initialRotaAssignments.length !== rotaAssignments.length;
    if (isInitialOrChange) {
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
    }
  // We're explicitly NOT including rotaIdsByDate and rotaAssignments in the dependency array
  // to prevent infinite loops, as we update them in the effect
  // Using a custom deep comparison function for objects to prevent unnecessary rerenders
  }, [allRotas, 
      // Compare initialRotaAssignments by length only to reduce rerenders
      initialRotaAssignments?.length, 
      // We don't need to deeply compare these, just check if they exist
      initialRotaIdsByDate ? Object.keys(initialRotaIdsByDate).length : 0, 
      effectiveViewOnly, 
      isViewOnly
  ]);

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
    if (effectiveViewOnly) return;
    
    // Don't clear assignments until we have new ones
    // Only set rotaGenerated to false to indicate we need a new generation
    setRotaGenerated(false);
    setHasExistingConfig(false); // Reset when Monday changes
    
    // Detect bank holidays for the selected week
    if (selectedMonday) {
      // Load existing configuration for this week
      const loadConfiguration = async () => {
        try {
          console.log('[RotaView] Loading configuration for week starting:', selectedMonday);
          // Use convex.query directly here
          const config = await convex.query(api.rotas.getRotaConfiguration, { weekStartDate: selectedMonday });
          
          if (config) {
            console.log('[RotaView] Found saved configuration:', config);
            
            // Restore saved configuration
            setSelectedClinicIds(config.selectedClinicIds);
            setSelectedPharmacistIds(config.selectedPharmacistIds);
            setSelectedWeekdays(config.selectedWeekdays);
            setPharmacistWorkingDays(config.pharmacistWorkingDays);
            setSinglePharmacistDispensaryDays(config.singlePharmacistDispensaryDays);
            setIgnoredUnavailableRules(config.ignoredUnavailableRules || {});
            setRotaUnavailableRules(config.rotaUnavailableRules || {});
            
            // If configuration has a generated rota, set rotaGenerated to true
            if (config.isGenerated) {
              setRotaGenerated(true);
            }
            setHasExistingConfig(true); // Set true if config is found
          } else {
            console.log('[RotaView] No saved configuration found, using defaults');
          }
        } catch (error) {
          console.error('[RotaView] Error loading configuration:', error);
          setHasExistingConfig(false); // Ensure it's false on error
        }
      };
      
      loadConfiguration();
      
      // Process bank holidays
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
  }, [selectedMonday, effectiveViewOnly, convex]); // Added convex to dependency array

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
      
      // Save the configuration before generating the rota
      try {
        // Get current user info for tracking
        const userName = currentUser?.name || currentUser?.email || 'Unknown User';
        
        await saveRotaConfiguration({
          weekStartDate: selectedMonday,
          selectedClinicIds,
          selectedPharmacistIds,
          selectedWeekdays,
          pharmacistWorkingDays,
          singlePharmacistDispensaryDays: daysToUse,
          ignoredUnavailableRules,
          rotaUnavailableRules,
          userName,
          isGenerated: true // Mark that we're generating a rota with this configuration
        });
        
        console.log(`[handleGenerateWeeklyRota] Configuration saved for week starting: ${selectedMonday}`);
      } catch (configError) {
        console.error('[handleGenerateWeeklyRota] Error saving configuration:', configError);
        // Continue with generation even if saving config fails
      }
      
      // Generate the rota
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

  // Only log in development and with a condition to reduce noise
  if (process.env.NODE_ENV === 'development' && rotaAssignments.length > 0 && !window.__rotaViewRendered) {
    console.log('Rendering rotaAssignments', rotaAssignments.length);
    // Set a flag to prevent this from logging every render
    window.__rotaViewRendered = true;
    // Reset the flag after 2 seconds to allow occasional logging
    setTimeout(() => { window.__rotaViewRendered = false; }, 2000);
  }

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
    
    // Only log in development and with a condition to reduce noise
    if (process.env.NODE_ENV === 'development' && !window.__sortedSelectedClinicsLogged) {
      console.log('[sortedSelectedClinics] Clinic IDs in rota:', Array.from(clinicIdsInRota));
      console.log('[sortedSelectedClinics] Selected clinic IDs from UI:', selectedClinicIds);
      console.log('[sortedSelectedClinics] Using clinic IDs:', clinicIdsToUse);
      console.log('[sortedSelectedClinics] View only mode:', effectiveViewOnly);
      // Set a flag to prevent logging every render
      window.__sortedSelectedClinicsLogged = true;
      // Reset the flag after 2 seconds
      setTimeout(() => { window.__sortedSelectedClinicsLogged = false; }, 2000);
    }
    
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

    console.log(`[handleEmptyCellClick] Empty cell clicked: ${location}, ${type}, ${date}, ${start}-${end}`);

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

    // Check if this is a lunch cover assignment
    const isLunchCover = assignment.isLunchCover === true;
    
    // In edit mode, we might not have the rota in allRotas, so we'll work with rotaAssignments directly
    let clickedAssignmentIndex = -1;
    let otherPharmacistIds: Id<"pharmacists">[] = [];
    
    // Try to find the rota in allRotas first
    const rota = allRotas.find((r: any) => r._id === rotaId);
    
    if (rota && rota.assignments) {
      // For lunch cover, we need to be more specific in our search
      if (isLunchCover) {
        clickedAssignmentIndex = rota.assignments.findIndex((a: any) => 
          a.location === assignment.location && 
          a.isLunchCover === true &&
          a.pharmacistId === currentPharmacistId
        );
        
        // For lunch cover, we don't want any "other pharmacists" - only one can be assigned
        otherPharmacistIds = [];
      } else {
        // Regular mode: Find the clicked pharmacist's assignment index
        clickedAssignmentIndex = rota.assignments.findIndex((a: any) => 
          a.location === assignment.location && 
          ((a.startTime === cellStartTime && a.endTime === cellEndTime) ||
           (a.startTime === assignment.startTime && a.endTime === assignment.endTime)) &&
          a.pharmacistId === currentPharmacistId
        );

        // Find all other pharmacists assigned to the same cell (same location, time, date)
        if (clickedAssignmentIndex !== -1) {
          const otherAssignments = rota.assignments.filter((a: any, index: number) => 
            index !== clickedAssignmentIndex && // Not the clicked assignment
            a.location === assignment.location && 
            ((a.startTime === cellStartTime && a.endTime === cellEndTime) ||
             (a.startTime === assignment.startTime && a.endTime === assignment.endTime))
          );

          otherPharmacistIds = otherAssignments.map((a: any) => a.pharmacistId);
        }
      }
    } 
  
    // If we couldn't find in allRotas or clickedAssignmentIndex is -1, try rotaAssignments (edit mode)
    if (clickedAssignmentIndex === -1) {
      if (isLunchCover) {
        // For lunch cover, find exact lunch cover assignment
        const lunchCoverAssignment = rotaAssignments.find(a => 
          a.date === assignmentDate &&
          a.location === assignment.location && 
          a.isLunchCover === true
        );
        
        if (lunchCoverAssignment) {
          // Set a dummy index for the assignment
          clickedAssignmentIndex = 0;
          
          // No other pharmacists for lunch cover
          otherPharmacistIds = [];
        }
      } else {
        // Find other pharmacists assigned to the same cell from rotaAssignments
        const sameSlotAssignments = rotaAssignments.filter(a => 
          a.date === assignmentDate &&
          a.location === assignment.location && 
          ((a.startTime === cellStartTime && a.endTime === cellEndTime) ||
           (a.startTime === assignment.startTime && a.endTime === assignment.endTime) ||
           (a.start === cellStartTime && a.end === cellEndTime))
        );
        
        // Set a dummy index for edit mode
        clickedAssignmentIndex = 0;
        
        // Get other pharmacist IDs excluding the current one
        otherPharmacistIds = sameSlotAssignments
          .filter(a => a.pharmacistId !== currentPharmacistId)
          .map(a => a.pharmacistId);
      }
    }
    
    console.log(`[handleCellClick] Selected pharmacist ${currentPharmacistId}`);
    console.log(`[handleCellClick] Is lunch cover: ${isLunchCover}`);
    console.log(`[handleCellClick] Other pharmacists in this cell: ${otherPharmacistIds.length > 0 ? otherPharmacistIds.join(', ') : 'none'}`);
    console.log(`[handleCellClick] Selected time slot: ${cellStartTime}-${cellEndTime}`);

    // Store both the selected pharmacist and other pharmacists in the cell
    setSelectedCell({ 
      rotaId,
      assignmentIndices: [clickedAssignmentIndex],
      currentPharmacistId,
      location: isLunchCover ? "Dispensary (Lunch Cover)" : assignment.location,
      date: assignmentDate,
      startTime: cellStartTime || assignment.startTime,
      endTime: cellEndTime || assignment.endTime,
      otherPharmacistIds, // Keep track of other pharmacists in the same cell
      // Add appropriate newAssignment based on the type
      newAssignment: isLunchCover ? {
        location: "Dispensary", // Keep this as Dispensary to match backend expectations
        type: "dispensary",
        startTime: cellStartTime || assignment.startTime,
        endTime: cellEndTime || assignment.endTime,
        isLunchCover: true
      } : undefined
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
  let isLunchCover = false;
  
  if (newAssignment) {
    isDispensary = newAssignment.type === "dispensary";
    isClinic = newAssignment.type === "clinic";
    isLunchCover = newAssignment.isLunchCover === true;
  }
  
  // Also check the location name for lunch cover
  if (selectedCell.location === "Dispensary (Lunch Cover)") {
    isLunchCover = true;
    isDispensary = true;
  }
  
  console.log(`[handlePharmacistSelect] Cell category: ` +
    `${isUnavailable ? 'Unavailable' : ''}` +
    `${isManagement ? 'Management' : ''}` +
    `${isDispensary ? 'Dispensary' : ''}` +
    `${isClinic ? 'Clinic' : ''}` +
    `${isLunchCover ? ' (Lunch Cover)' : ''}`);

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
                   
    // For lunch cover, first check if there's already an existing lunch cover assignment we need to update
    if (isLunchCover) {
      console.log("[handlePharmacistSelect] Searching for existing lunch cover assignment to update");
      
      // Find the rota for this date
      const rotaForDate = allRotas.find((r: any) => r._id === selectedCell.rotaId);
      
      if (rotaForDate) {
        // Look for any existing lunch cover assignment for this date
        const existingLunchCoverIndex = rotaForDate.assignments.findIndex((a: any) => 
          a.type === "dispensary" && 
          a.isLunchCover === true
        );
        
        if (existingLunchCoverIndex !== -1) {
          console.log(`[handlePharmacistSelect] Found existing lunch cover assignment at index ${existingLunchCoverIndex}, updating it instead of creating a new one`);
          
          // Update the existing lunch cover assignment with the new pharmacist
          await updateAssignment({
            rotaId: selectedCell.rotaId,
            assignmentIndex: existingLunchCoverIndex,
            pharmacistId
            // Don't include newAssignment to preserve other properties
          });
          
          console.log("[handlePharmacistSelect] Successfully updated existing lunch cover assignment");
          
          // Skip standard new assignment creation for lunch cover
          // We'll still handle scope-based functionality below if needed
        } else {
          console.log("[handlePharmacistSelect] No existing lunch cover assignment found, will create a new one");
          
          // Create a new lunch cover assignment
          await updateAssignment({
            rotaId: selectedCell.rotaId,
            assignmentIndex: -1,
            pharmacistId,
            newAssignment
          });
          console.log("[handlePharmacistSelect] New lunch cover assignment created.");
        }
      } else {
        console.log("[handlePharmacistSelect] Could not find rota for this date, creating new lunch cover assignment");
        
        // Create a new lunch cover assignment as fallback
        await updateAssignment({
          rotaId: selectedCell.rotaId,
          assignmentIndex: -1,
          pharmacistId,
          newAssignment
        });
        console.log("[handlePharmacistSelect] Fallback new lunch cover assignment created.");
      }
    } else if (newAssignment) {
      // Regular non-lunch cover new assignment handling
      console.log("[handlePharmacistSelect] Handling regular new assignment creation.");
      
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
      // Skip this part for lunch cover assignments - they shouldn't be duplicated for all time slots
      if (scope !== "slot" && !isLunchCover) {
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
        
        // Check if we're editing a specific pharmacist in a multi-pharmacist cell
        const isReplacingSpecificPharmacist = selectedCell.currentPharmacistId !== null;
        
        if (isReplacingSpecificPharmacist) {
          console.log(`[handlePharmacistSelect] Replacing specific pharmacist ${selectedCell.currentPharmacistId} with ${pharmacistId}`);
          console.log(`[handlePharmacistSelect] Time slot: ${selectedCell.startTime}-${selectedCell.endTime}`);
          
          // Get the assignment for the specific pharmacist we're replacing
          const rota = allRotas.find((r: any) => r._id === selectedCell.rotaId);
          
          if (rota && rota.assignments) {
            // Find the specific assignment index to replace
            const assignmentIndexToReplace = rota.assignments.findIndex((a: any) => 
              a.location === selectedCell.location && 
              a.startTime === selectedCell.startTime && 
              a.endTime === selectedCell.endTime &&
              a.pharmacistId === selectedCell.currentPharmacistId
            );
            
            if (assignmentIndexToReplace !== -1) {
              console.log(`[handlePharmacistSelect] Found assignment to replace at index ${assignmentIndexToReplace}`);
              
              // CRITICAL FIX: When updating an existing pharmacist in a multi-pharmacist cell,
              // we must NOT provide newAssignment parameter to the backend function.
              // The backend will create a new assignment if newAssignment is provided, 
              // which would replace all pharmacists with just the new one.
              await updateAssignment({
                rotaId: selectedCell.rotaId,
                assignmentIndex: assignmentIndexToReplace,
                pharmacistId
                // Do NOT include newAssignment here! This is what causes the issue.
              });
              
              console.log(`[handlePharmacistSelect] Replaced specific pharmacist successfully (preserving others)`);

              // For time slot specific assignments, make sure to retain other pharmacists who might be in this cell
              if (selectedCell.otherPharmacistIds && selectedCell.otherPharmacistIds.length > 0) {
                console.log(`[handlePharmacistSelect] Slot has ${selectedCell.otherPharmacistIds.length} other pharmacists that are being preserved`);
                // The other pharmacists' assignments remain untouched since we only updated the specific pharmacist ID
              }
            } else {
              console.log(`[handlePharmacistSelect] Could not find exact assignment in rota, trying rotaAssignments`);
              console.log(`[handlePharmacistSelect] DEBUG: Looking for pharmacist ${selectedCell.currentPharmacistId} in location ${selectedCell.location} at time ${selectedCell.startTime}-${selectedCell.endTime}`);
              
              // Detailed logging of all assignments for this slot to help debug
              // Search for assignments both with exact time slot and full-day assignments, but we'll handle them differently
              // Full-day assignments are used for reference to find pharmacists, but we won't update them
              const allAssignmentsForThisSlot = rotaAssignments.filter(a => 
                a.location === selectedCell.location &&
                a.date === selectedCell.date &&
                ((a.startTime === selectedCell.startTime && a.endTime === selectedCell.endTime) || 
                 (a.startTime === '00:00' && a.endTime === '23:59')) // Include full-day assignments
              );
              
              // Separately track exact time slot assignments vs full-day assignments
              const exactTimeSlotAssignments = rotaAssignments.filter(a => 
                a.location === selectedCell.location &&
                a.date === selectedCell.date &&
                a.startTime === selectedCell.startTime && 
                a.endTime === selectedCell.endTime
              );
              
              const fullDayAssignments = rotaAssignments.filter(a => 
                a.location === selectedCell.location &&
                a.date === selectedCell.date &&
                a.startTime === '00:00' && 
                a.endTime === '23:59'
              );
              
              console.log(`[handlePharmacistSelect] DEBUG: Found ${allAssignmentsForThisSlot.length} assignments for this slot:`, 
                allAssignmentsForThisSlot.map(a => ({ 
                  pharmacistId: a.pharmacistId, 
                  pharmacistName: getPharmacistName(a.pharmacistId),
                  startTime: a.startTime, 
                  endTime: a.endTime 
                }))
              );
              
              // Try to find the assignment we want to update - the pharmacist we're replacing
              const assignmentToUpdate = rotaAssignments.find(a => 
                a.pharmacistId === selectedCell.currentPharmacistId &&
                a.location === selectedCell.location &&
                a.date === selectedCell.date &&
                ((a.startTime === selectedCell.startTime && a.endTime === selectedCell.endTime) ||
                 (a.startTime === '00:00' && a.endTime === '23:59')) // Handle full-day assignments
              );
              
              if (assignmentToUpdate) {
                console.log(`[handlePharmacistSelect] DEBUG: Found assignment to update:`, {
                  pharmacistId: assignmentToUpdate.pharmacistId,
                  pharmacistName: getPharmacistName(assignmentToUpdate.pharmacistId),
                  location: assignmentToUpdate.location,
                  date: assignmentToUpdate.date,
                  startTime: assignmentToUpdate.startTime,
                  endTime: assignmentToUpdate.endTime
                });
                
                // We found it in rotaAssignments, but not in the rota itself
                // CRITICAL FIX: Instead of creating a new assignment, we need to find a way
                // to update the existing one even though we don't have its index in the rota
                
                try {
                  // APPROACH: Create a completely new set of assignments for this cell
                  // by replacing only the specific pharmacist we want to update
                  
                  // 1. Get the index of the rota for this date
                  const rotaForDate = allRotas.find(r => r._id === selectedCell.rotaId);
                  
                  if (rotaForDate) {
                    console.log(`[handlePharmacistSelect] DEBUG: Found rota for date ${selectedCell.date}, ID: ${selectedCell.rotaId}`);
                    
                    // 2. For reference, get both time-specific and full-day assignments
                    // But we'll handle them separately to ensure the right behavior
                    let timeSpecificAssignments = rotaForDate.assignments.filter(a => 
                      a.location === selectedCell.location && 
                      a.startTime === selectedCell.startTime && 
                      a.endTime === selectedCell.endTime
                    );
                    
                    let fullDayAssignments = rotaForDate.assignments.filter(a => 
                      a.location === selectedCell.location && 
                      a.startTime === '00:00' && 
                      a.endTime === '23:59'
                    );
                    
                    console.log(`[handlePharmacistSelect] DEBUG: Found ${timeSpecificAssignments.length} time-specific assignments and ${fullDayAssignments.length} full-day assignments for this cell.`);
                    
                    // For multi-pharmacist cells like EAU, we prefer to work with time-specific assignments
                    let cellAssignments = timeSpecificAssignments.length > 0 ? 
                      timeSpecificAssignments : fullDayAssignments;
                    
                    if (cellAssignments.length > 0) {
                      // 3. Find the assignment for the pharmacist we want to replace
                      const assignmentIndexInCell = cellAssignments.findIndex(a => 
                        a.pharmacistId === selectedCell.currentPharmacistId
                      );
                      
                      if (assignmentIndexInCell !== -1) {
                        console.log(`[handlePharmacistSelect] DEBUG: Found assignment at index ${assignmentIndexInCell} in the cell assignments array`);
                        
                        // 4. Update this specific assignment with the new pharmacist ID
                        const updatedAssignment = {
                          ...cellAssignments[assignmentIndexInCell],
                          pharmacistId: pharmacistId
                        };
                        
                        // 5. Find the actual index in the full rota assignments array
                        // We need to check if there's a specific time slot assignment first
                        const exactTimeSlotIndex = rotaForDate.assignments.findIndex(a => 
                          a.location === selectedCell.location && 
                          a.startTime === selectedCell.startTime && 
                          a.endTime === selectedCell.endTime &&
                          a.pharmacistId === selectedCell.currentPharmacistId
                        );
                        
                        // Then check for a full-day assignment
                        const fullDayAssignmentIndex = rotaForDate.assignments.findIndex(a => 
                          a.location === selectedCell.location && 
                          a.startTime === '00:00' && 
                          a.endTime === '23:59' &&
                          a.pharmacistId === selectedCell.currentPharmacistId
                        );
                        
                        console.log(`[handlePharmacistSelect] DEBUG: Found exact time slot index: ${exactTimeSlotIndex}, full day index: ${fullDayAssignmentIndex}`);
                        
                        // If we have an exact time slot assignment, update it directly
                        if (exactTimeSlotIndex !== -1) {
                          console.log(`[handlePharmacistSelect] DEBUG: Updating existing time-specific assignment`);
                          
                          await updateAssignment({
                            rotaId: selectedCell.rotaId,
                            assignmentIndex: exactTimeSlotIndex,
                            pharmacistId
                            // Don't include newAssignment to preserve structure
                          });
                          
                          console.log(`[handlePharmacistSelect] Updated specific time slot assignment successfully`);
                        }
                        // If we only have a full-day assignment, we need to create a comprehensive solution
                        else if (fullDayAssignmentIndex !== -1 || (selectedCell.otherPharmacistIds && selectedCell.otherPharmacistIds.length > 0)) {
                          console.log(`[handlePharmacistSelect] DEBUG: Complex nested cell case. Creating a complete solution for this time slot`);
                          
                          // 1. First, let's get all the pharmacists that should be in this cell AFTER the edit
                          const pharmacistsAfterEdit = new Set<string>();
                          
                          // 2. Add all the current pharmacists except the one being replaced
                          if (selectedCell.otherPharmacistIds) {
                            selectedCell.otherPharmacistIds.forEach(id => {
                              if (id !== selectedCell.currentPharmacistId) { // Don't add the one being replaced
                                pharmacistsAfterEdit.add(id);
                              }
                            });
                          }
                          
                          // 3. Add the new pharmacist
                          pharmacistsAfterEdit.add(pharmacistId);
                          
                          console.log(`[handlePharmacistSelect] DEBUG: Pharmacists in cell after edit:`, 
                            Array.from(pharmacistsAfterEdit).map(id => getPharmacistName(id)));
                          
                          // 4. For each pharmacist, create or update a time-specific assignment
                          for (const idString of pharmacistsAfterEdit) {
                            // Need to properly cast the string to a typed Id for the pharmacists table
                            // This fixes the TypeScript error: Type 'string' is not assignable to type 'Id<"pharmacists">'
                            const idAsPharmacistId = idString as Id<"pharmacists">;
                            
                            // Check if this pharmacist already has a time-specific assignment for this slot
                            const existingAssignmentIndex = rotaForDate.assignments.findIndex(a => 
                              a.location === selectedCell.location && 
                              a.startTime === selectedCell.startTime && 
                              a.endTime === selectedCell.endTime &&
                              a.pharmacistId === idAsPharmacistId
                            );
                            
                            if (existingAssignmentIndex !== -1) {
                              console.log(`[handlePharmacistSelect] DEBUG: Pharmacist ${getPharmacistName(idAsPharmacistId)} already has a time-specific assignment, leaving it unchanged`);
                              // This pharmacist already has a time-specific assignment, leave it as is
                            } else {
                              // Create a new time-specific assignment for this pharmacist
                              console.log(`[handlePharmacistSelect] DEBUG: Creating new time-specific assignment for ${getPharmacistName(idAsPharmacistId)}`);
                              
                              await updateAssignment({
                                rotaId: selectedCell.rotaId,
                                assignmentIndex: -1, // Create new
                                pharmacistId: idAsPharmacistId,
                                newAssignment: {
                                  location: selectedCell.location,
                                  type: "ward",
                                  startTime: selectedCell.startTime,
                                  endTime: selectedCell.endTime
                                }
                              });
                            }
                          }
                          
                          console.log(`[handlePharmacistSelect] Created/updated time-specific assignments for all ${pharmacistsAfterEdit.size} pharmacists in this cell`);
                        } else {
                          console.log(`[handlePharmacistSelect] DEBUG: Could not find assignment in the full rota, using alternative approach`);
                          
                          // Alternative approach: check if new pharmacist already has an assignment
                          const existingNewPharmacistAssignment = allAssignmentsForThisSlot.find(a => 
                            a.pharmacistId === pharmacistId
                          );
                          
                          if (!existingNewPharmacistAssignment) {
                            // Create assignment for new pharmacist
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
                            
                            console.log(`[handlePharmacistSelect] Created new assignment for ${pharmacistId}, now need to remove old one`);
                            
                            // In this case, we need to manually find and remove the old pharmacist's assignment
                            // This will be handled by the state update at the end of the function
                          } else {
                            console.log(`[handlePharmacistSelect] Pharmacist ${pharmacistId} already has assignment in this slot`);
                          }
                        }
                      } else {
                        console.log(`[handlePharmacistSelect] DEBUG: Could not find the pharmacist ${selectedCell.currentPharmacistId} in the cell assignments`);
                        
                        // Just add the new pharmacist to the cell
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
                        
                        console.log(`[handlePharmacistSelect] Added pharmacist to cell as could not find existing one to replace`);
                      }
                    } else {
                      console.log(`[handlePharmacistSelect] DEBUG: No assignments found in rota, creating new one`);
                      
                      // No assignments found in the rota, create a new one
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
                      
                      console.log(`[handlePharmacistSelect] Created new assignment for empty cell`);
                    }
                  } else {
                    console.error(`[handlePharmacistSelect] DEBUG: Could not find rota for date ${selectedCell.date}`);
                    
                    // Fallback: just create a new assignment
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
                    
                    console.log(`[handlePharmacistSelect] Created new assignment as fallback`);
                  }
                } catch (error) {
                  console.error(`[handlePharmacistSelect] DEBUG: Error during complex replacement:`, error);
                  
                  // Final fallback if all else fails: create a new assignment
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
                  
                  console.log(`[handlePharmacistSelect] Created new assignment as error fallback`);
                }
              } else {
                console.error(`[handlePharmacistSelect] DEBUG: Could not find assignment to replace in rotaAssignments either`);
                
                // Fall back to creating a new assignment for this specific time slot
                // But first check if there's already an assignment for this pharmacist and slot
                const existingAssignment = rotaAssignments.find(a => 
                  a.pharmacistId === pharmacistId &&
                  a.location === selectedCell.location &&
                  a.date === selectedCell.date &&
                  a.startTime === selectedCell.startTime &&
                  a.endTime === selectedCell.endTime
                );
                
                if (!existingAssignment) {
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
                  
                  console.log(`[handlePharmacistSelect] Created new time-specific assignment as fallback`);
                } else {
                  console.log(`[handlePharmacistSelect] Pharmacist already has an assignment for this slot, no need to create a new one`);
                }
              }
            }
          } else {
            console.log(`[handlePharmacistSelect] Rota not found in allRotas, trying rotaAssignments`);
            
            // If we can't find the rota, we're in edit mode or something changed in the backend
            // Check if the new pharmacist already has an assignment for this slot
            const existingNewPharmacistAssignment = rotaAssignments.find(a => 
              a.pharmacistId === pharmacistId &&
              a.location === selectedCell.location &&
              a.date === selectedCell.date &&
              a.startTime === selectedCell.startTime &&
              a.endTime === selectedCell.endTime
            );
            
            if (!existingNewPharmacistAssignment) {
              // Only create a new assignment if one doesn't already exist
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
              
              console.log(`[handlePharmacistSelect] Created new assignment since we couldn't update directly`);
            } else {
              console.log(`[handlePharmacistSelect] Pharmacist already has an assignment for this slot, no need to create a new one`);
            }
          }
        } else {
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
        }
      } else {
        // For day or week scope
        console.log(`[handlePharmacistSelect] Handling ${scope} scope for ward`);
        
        // Check if we're editing a specific pharmacist in a multi-pharmacist cell
        const isReplacingSpecificPharmacist = selectedCell.currentPharmacistId !== null;
        
        if (isReplacingSpecificPharmacist) {
          console.log(`[handlePharmacistSelect] Day/Week scope: Replacing specific pharmacist ${selectedCell.currentPharmacistId} with ${pharmacistId}`);
          
          // Get all assignments for this pharmacist in the selected location for the relevant date(s)
          const assignmentsToUpdate = getAssignmentsForScope(
            selectedCell.location, 
            selectedCell.date, 
            scope,
            selectedCell.startTime,
            selectedCell.endTime,
            selectedCell.currentPharmacistId // Search only for the specific pharmacist's assignments
          );
          
          console.log(`[handlePharmacistSelect] Found ${assignmentsToUpdate.length} specific pharmacist assignments to update`);
          
          if (assignmentsToUpdate.length === 0) {
            console.warn("[handlePharmacistSelect] No assignments found to update for the selected pharmacist.");
            return;
          }
          
          // Update only the assignments for the specific pharmacist
          for (const { rotaId, indices } of assignmentsToUpdate) {
            console.log(`[handlePharmacistSelect] Updating ${indices.length} assignments for specific pharmacist in rota ${rotaId}`);
            for (const idx of indices) {
              await updateAssignment({
                rotaId,
                assignmentIndex: idx,
                pharmacistId
              });
            }
          }
        } else {
          // Normal behavior for non-specific pharmacist selection
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
      }
      console.log("[handlePharmacistSelect] Finished updating assignments.");
    }

    // Refresh the local state to show the updated assignments
    console.log("[handlePharmacistSelect] Refreshing local rotaAssignments state.");
    
    // For dispensary assignments, first update our local state to reflect the change immediately
    if (isDispensary || selectedCell.location === "Dispensary" || selectedCell.location === "Dispensary (Lunch Cover)") {
      console.log("[handlePharmacistSelect] Immediately updating local dispensary assignment");
      console.log(`[handlePharmacistSelect] Location: ${selectedCell.location}, isLunchCover: ${selectedCell.newAssignment?.isLunchCover}`);
      
      // Check if we're dealing with a lunch cover assignment
      const isLunchCoverAssignment = selectedCell.location === "Dispensary (Lunch Cover)" || selectedCell.newAssignment?.isLunchCover === true;
      
      // Find any existing lunch cover assignments we need to remove
      let hasRemoved = false;
      if (isLunchCoverAssignment) {
        console.log("[handlePharmacistSelect] Removing any previous lunch cover assignments for this date");
        
        // Remove all lunch cover assignments for this date to ensure we don't have duplicates
        const withoutPreviousLunchCovers = rotaAssignments.filter(a => {
          if (a.date === selectedCell.date && a.type === "dispensary" && a.isLunchCover === true) {
            console.log(`[handlePharmacistSelect] Removing previous lunch cover assignment from ${getPharmacistName(a.pharmacistId)}`);
            hasRemoved = true;
            return false; // Remove this assignment
          }
          return true; // Keep all other assignments
        });
        
        if (hasRemoved) {
          // Update state without the previous lunch cover assignments
          setRotaAssignments(withoutPreviousLunchCovers);
          
          // Add the new lunch cover assignment
          const newLunchCoverAssignment = {
            date: selectedCell.date,
            type: "dispensary",
            location: "Dispensary",
            startTime: selectedCell.startTime,
            endTime: selectedCell.endTime,
            isLunchCover: true,
            pharmacistId: pharmacistId
          };
          
          console.log(`[handlePharmacistSelect] Adding new lunch cover assignment for ${getPharmacistName(pharmacistId)}`);
          
          // Update the state with the new lunch cover assignment
          setRotaAssignments(prev => [...prev, newLunchCoverAssignment]);
          return; // Skip the regular update below since we've handled it specially
        }
      }
      
      // Regular update for non-lunch cover or if we didn't find any lunch covers to remove
      const updatedAssignments = rotaAssignments.map(a => {
        // Special handling for lunch cover assignments
        if (isLunchCoverAssignment && a.date === selectedCell.date && a.type === "dispensary" && a.isLunchCover === true) {
          console.log(`[handlePharmacistSelect] Found lunch cover assignment to update: ${getPharmacistName(a.pharmacistId)} → ${getPharmacistName(pharmacistId)}`);
          
          // Return the updated lunch cover assignment
          return {
            ...a,
            pharmacistId
          };
        }
        // Regular dispensary assignments
        else if (!isLunchCoverAssignment && 
                a.date === selectedCell.date && 
                a.type === "dispensary" && 
                a.location === selectedCell.location && 
                a.startTime === selectedCell.startTime && 
                a.endTime === selectedCell.endTime && 
                a.pharmacistId === selectedCell.currentPharmacistId) {
          
          console.log(`[handlePharmacistSelect] Found regular dispensary assignment to update: ${getPharmacistName(a.pharmacistId)} → ${getPharmacistName(pharmacistId)}`);
          
          // Return a new assignment with updated pharmacistId
          return {
            ...a,
            pharmacistId
          };
        }
        return a;
      });
      
      // Update the local state immediately
      setRotaAssignments(updatedAssignments);
    }
    
    // Also get fresh assignments from the server to ensure we have the most accurate state
    // This ensures we preserve all multi-pharmacist cells exactly as they are in the database
    const refreshedAssignments = allRotas.flatMap((r: any) => { 
      // Map each assignment to include its date
      const assignmentsWithDate = r.assignments.map((a: any) => ({ ...a, date: r.date }));
      return assignmentsWithDate;
    });
    
    // If we have any assignments from server, update our state
    if (refreshedAssignments.length > 0) {
      setRotaAssignments(refreshedAssignments);
      console.log(`[handlePharmacistSelect] Local state refreshed with ${refreshedAssignments.length} assignments from server.`);
    } else {
      console.warn("[handlePharmacistSelect] No assignments found during server refresh.");
    }
    
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
        {/* Only show date selector and Create Rota button in non-view-only mode */}
        {!effectiveViewOnly ? (
          <>
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
                // Keep track of current configuration
                if (selectedMonday) {
                  // Save current configuration when starting rota creation
                  try {
                    const userName = currentUser?.name || currentUser?.email || 'Unknown User';
                    saveRotaConfiguration({
                      weekStartDate: selectedMonday,
                      selectedClinicIds,
                      selectedPharmacistIds,
                      selectedWeekdays,
                      pharmacistWorkingDays, 
                      singlePharmacistDispensaryDays,
                      ignoredUnavailableRules,
                      rotaUnavailableRules,
                      userName,
                      isGenerated: false // Not generated yet
                    });
                  } catch (error) {
                    console.error('Error saving configuration:', error);
                  }
                }
                
                setShowClinicSelection(true);
                setRotaGenerated(false);
              }}
            >
              {hasExistingConfig ? 'Update Rota Details' : 'Create Rota'}
            </button>
          </>
        ) : null}
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
                      <span className="text-sm font-medium">Available on:</span>
                      {CLINIC_DAY_LABELS.map((day: string) => {
                        const isSelected = pharmacistWorkingDays[pharmacist._id]?.includes(day) || false;
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
                                newObj[pharmacist._id] = [...pharmacistWorkingDays[pharmacist._id]];
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
                    !p.isDefaultPharmacist &&
                    !selectedPharmacistIds.includes(p._id) &&
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
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded flex items-center"
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
                  <>
                    <button
                      className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50 flex items-center mr-2"
                      onClick={handleShuffleDispensaryShifts}
                      disabled={isViewOnly || generatingWeekly}
                      title="Randomly reassign dispensary shifts while keeping other assignments"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                      Shuffle Dispensary Shifts
                    </button>
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
                  </>
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
          
          {/* Only display the rota table when in view-only mode or after the rota has been generated */}
          {(effectiveViewOnly || rotaGenerated) && (
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
                      <div className="flex items-center justify-center h-full w-full">
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
            className={`p-1 text-xs bg-gray-50 font-semibold ${assignment ? getPharmacistCellClass(assignment.pharmacistId) : 'cursor-pointer hover:bg-gray-100'} ${isDeselected ? 'bg-gray-200 not-selected-cell' : ''} ${!effectiveViewOnly && assignment ? 'rota-drag-cell' : ''}`}
            style={{ 
              borderTop: 'none',
              borderBottom: 'none', 
              height: '2.5em', 
              minHeight: '2.5em', 
              lineHeight: '1.2', 
              whiteSpace: 'normal', 
              wordBreak: 'break-word'
            }}
            onClick={() => {
              if (isDeselected || effectiveViewOnly) return;
              if (!assignment) {
                // Handle empty cell click to create new assignment
                handleEmptyCellClick("Dispensary", "dispensary", isoDate, slot.start, slot.end);
              }
            }}
            onDragOver={(e) => assignment && handleDragOver(e, assignment.pharmacistId, assignment, "Dispensary", isoDate, slot.start, slot.end)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-pharmacist-id={assignment ? assignment.pharmacistId : ''}
            data-location="Dispensary"
            data-date={isoDate}
            data-start-time={slot.start}
            data-end-time={slot.end}
            data-deselected={isDeselected ? 'true' : 'false'}
          >
            {isDeselected ? (
              <NotSelectedOverlay />
            ) : assignment ? (
              <div 
                className={`flex items-center justify-center h-full w-full ${!effectiveViewOnly ? 'cursor-grab' : ''}`}
                draggable={!effectiveViewOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!effectiveViewOnly) {
                    // Pass the isLunchCover flag to correctly identify this assignment type
                    const assignmentWithLunchFlag = {
                      ...assignment,
                      isLunchCover: isLunch
                    };
                    handleCellClick(assignmentWithLunchFlag, assignment.pharmacistId, slot.start, slot.end);
                  }
                }}
                onDragStart={(e) => handleDragStart(e, assignment.pharmacistId, assignment, "Dispensary", isoDate, slot.start, slot.end)}
                onDragEnd={handleDragEnd}
              >
                <span className={`text-center w-full ${hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}`}>
                  {displayName}{isLunch && " (lunch cover)"}
                </span>
              </div>
            ) : (
              <span className="text-blue-700">+</span>
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
                  className={`p-1 text-center truncate max-w-[70px] text-xs align-middle ${isDeselected ? 'bg-gray-200 not-selected-cell' : ''} ${!effectiveViewOnly && assignment ? 'rota-drag-cell' : ''}`}
                  style={{ 
                    border: 'none',
                    backgroundColor: isDeselected ? '#e5e7eb' : (assignment ? '#fef9c3' : '#fef9c3'), 
                    color: '#000', 
                    lineHeight: '1.2',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word'
                  }}
                  onClick={() => {
                    if (isDeselected || effectiveViewOnly) return;
                    if (!assignment) {
                      // Handle empty cell click to create new assignment
                      handleEmptyCellClick(clinic.name, "clinic", isoDate, slot.start, slot.end);
                    }
                  }}
                  onDragOver={(e) => assignment && handleDragOver(e, assignment.pharmacistId, assignment, clinic.name, isoDate, slot.start, slot.end)}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  data-pharmacist-id={assignment ? assignment.pharmacistId : ''}
                  data-location={clinic.name}
                  data-date={isoDate}
                  data-start-time={slot.start}
                  data-end-time={slot.end}
                  data-deselected={isDeselected ? 'true' : 'false'}
                >
                  {isDeselected ? (
                    <NotSelectedOverlay />
                  ) : assignment ? (
                    <div 
                      className={`flex items-center justify-center h-full w-full ${!effectiveViewOnly ? 'cursor-grab' : ''}`}
                      draggable={!effectiveViewOnly}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!effectiveViewOnly) {
                          handleCellClick(assignment, assignment.pharmacistId, slot.start, slot.end);
                        }
                      }}
                      onDragStart={(e) => handleDragStart(e, assignment.pharmacistId, assignment, clinic.name, isoDate, slot.start, slot.end)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className={`text-center w-full ${hasOverlappingAssignments(assignment.pharmacistId, isoDate, slot) ? 'text-red-600 font-bold' : ''}`}>
                        {getPharmacistName(assignment.pharmacistId)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-blue-700">+</span>
                  )}
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
                      // Find unavailable pharmacists for this date/slot
                      const unavailable = rotaAssignments.filter(a => 
                        a.type === "unavailable" && 
                        a.date === isoDate && 
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
                           className={`p-1 text-xs bg-red-50 text-red-700 text-center${!effectiveViewOnly && !isDeselectedDay(date) ? 'cursor-pointer hover:bg-red-100' : ''} ${isDeselectedDay(date) ? 'bg-gray-200 not-selected-cell' : ''}`} 
                           style={{ 
                             borderTop: 'none',
                             borderBottom: 'none', 
                             lineHeight: '1.2', 
                             whiteSpace: 'normal', 
                             wordBreak: 'break-word',
                             ...(isDeselectedDay(date) ? { position: 'relative' as const, pointerEvents: 'none' as const } : {})
                           }}
                          onClick={(event) => {
                            if (isDeselectedDay(date)) return;
                            if (effectiveViewOnly) return; // Do not allow editing in view-only mode
                            // Reverted to createCellTextInput logic for free-text editing
                            const cellKey = `unavailable-${isoDate}-${slot.start}-${slot.end}`;
                            // Find all unavailable pharmacists for this cell to prepopulate text if cell is empty
                            const unavailableHere = rotaAssignments.filter(a => 
                              a.type === "unavailable" && 
                              a.date === isoDate && 
                              a.startTime === slot.start && 
                              a.endTime === slot.end
                            ).map(a => a.pharmacistDetails?.name || 'Unavailable');
                            
                            const currentText = freeCellText[cellKey] || unavailableHere.join(', ');
                            createCellTextInput(event.currentTarget as HTMLElement, cellKey, currentText, '#fee2e2'); // Light red background
                           }}
                        >
                          {(() => {
                            if (isDeselectedDay(date)) {
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
          )}
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
      {/* Pharmacist Report Modal */}
      {showPharmacistReport && selectedPharmacistForReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">
                Weekly Schedule for {pharmacists.find(p => p._id === selectedPharmacistForReport)?.displayName || 'Pharmacist'}
              </h3>
              <button 
                onClick={() => setShowPharmacistReport(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 border text-left">Day</th>
                    <th className="p-2 border text-left">Time</th>
                    <th className="p-2 border text-left">Location</th>
                    <th className="p-2 border text-left">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 7 }).map((_, dayOffset) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const dayName = DAYS[date.getDay()];
                    const isoDate = date.toISOString().split('T')[0];
                    
                    // Get all assignments for this pharmacist on this day
                    const dayAssignments = rotaAssignments.filter(a => 
                      a.pharmacistId === selectedPharmacistForReport && 
                      a.date === isoDate
                    );
                    
                    if (dayAssignments.length === 0) return null;
                    
                    // Define standard time slots
                    const standardTimeSlots = [
                      { start: '09:00', end: '11:00' },
                      { start: '11:00', end: '13:00' },
                      { start: '13:00', end: '15:00' },
                      { start: '15:00', end: '17:00' }
                    ];
                                        // Process assignments into time slots
                    const timeSlotAssignments = standardTimeSlots.map(slot => {
                      // Find all assignments that overlap with this time slot
                      const allAssignments = dayAssignments.filter(assignment => {
                        const assignmentStart = assignment.startTime || '00:00';
                        const assignmentEnd = assignment.endTime || '23:59';
                        
                        // Check if assignment overlaps with current time slot
                        return (
                          (assignmentStart <= slot.start && assignmentEnd > slot.start) || // starts before and ends during/after
                          (assignmentStart >= slot.start && assignmentStart < slot.end)  // starts during
                        );
                      });
                      
                      // Check for protected rota time (which appears as 'Unavailable' in main rota)
                      // We'll check this later after checking for dispensary/clinic assignments
                      const protectedTimePharmacists = getProtectedRotaTimePharmacists(isoDate, slot);
                      const hasProtectedTime = protectedTimePharmacists.some(p => p._id === selectedPharmacistForReport);
                      
                      // Check for dispensary or clinic assignments first (highest priority)
                      const hasDispensary = allAssignments.some(a => a.type === 'dispensary');
                      const hasClinic = allAssignments.some(a => a.type === 'clinic');
                      
                      // Then check for management/unavailable/protected time
                      const hasManagement = allAssignments.some(a => a.type === 'management');
                      const hasUnavailable = allAssignments.some(a => a.type === 'unavailable');
                      
                      const assignmentsInSlot = [];
                      
                      // Priority order:
                      // 1. Dispensary (including lunch cover)
                      // 2. Clinic
                      // 3. Management Time
                      // 4. Unavailable/Protected Time
                      // 5. Ward
                      
                      if (hasDispensary) {
                        // Show dispensary assignments (including lunch cover)
                        assignmentsInSlot.push(...allAssignments.filter(a => a.type === 'dispensary'));
                      } else if (hasClinic) {
                        // Show clinic assignments if no dispensary
                        assignmentsInSlot.push(...allAssignments.filter(a => a.type === 'clinic'));
                      } else if (hasManagement) {
                        // Show management time if no dispensary or clinic
                        assignmentsInSlot.push(...allAssignments.filter(a => a.type === 'management'));
                      } else if (hasUnavailable || hasProtectedTime) {
                        // Show unavailable or protected time if no other assignments
                        if (hasUnavailable) {
                          assignmentsInSlot.push(...allAssignments.filter(a => a.type === 'unavailable'));
                        } else if (hasProtectedTime) {
                          // Add protected time as an unavailable assignment
                          assignmentsInSlot.push({
                            type: 'unavailable',
                            location: 'Protected Rota Time',
                            startTime: slot.start,
                            endTime: slot.end
                          });
                        }
                      } else {
                        // Otherwise, show all assignments (likely just wards)
                        assignmentsInSlot.push(...allAssignments);
                      }
                      
                      return {
                        ...slot,
                        assignments: assignmentsInSlot
                      };
                    });
                    
                    return timeSlotAssignments.map((slot, timeIndex) => {
                      const { start, end, assignments } = slot;
                      const hasAssignments = assignments.length > 0;
                      
                      // If no assignments and it's not the first row, skip this time slot
                      if (!hasAssignments && timeIndex > 0) return null;
                      
                      return (
                        <tr key={`${dayOffset}-${timeIndex}`} className={timeIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          {timeIndex === 0 && (
                            <td className="p-2 border" rowSpan={timeSlotAssignments.filter(ts => ts.assignments.length > 0).length}>
                              {dayName}<br />
                              <span className="text-xs text-gray-500">{isoDate}</span>
                            </td>
                          )}
                          <td className="p-2 border">{start} - {end}</td>
                          <td className="p-2 border">
                            {hasAssignments ? (
                              assignments.map((a, idx) => (
                                <div 
                                  key={idx} 
                                  className={`${idx > 0 ? 'mt-1 pt-1 border-t' : ''} ${
                                    a.type === 'ward' 
                                      ? 'text-green-700 font-medium'
                                      : a.type === 'dispensary' 
                                        ? a.isLunchCover ? 'text-purple-600 font-medium' : 'text-purple-700 font-medium'
                                        : a.type === 'clinic' 
                                          ? 'text-red-600 font-medium' 
                                          : a.type === 'management'
                                            ? 'text-blue-600 font-medium'
                                            : ''
                                  }`}
                                >
                                  {a.type === 'management' 
                                    ? 'Management Time'
                                    : a.type === 'unavailable' 
                                      ? 'Unavailable'
                                      : a.location.includes('Lunch Cover') 
                                        ? a.location 
                                        : `${a.location}${a.isLunchCover ? ' (Lunch Cover)' : ''}`}
                                </div>
                              ))
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="p-2 border">
                            {hasAssignments ? (
                              assignments.map((a, idx) => (
                                <div 
                                  key={idx} 
                                  className={`${idx > 0 ? 'mt-1 pt-1 border-t' : ''} ${
                                    a.type === 'ward' 
                                      ? 'text-green-700 font-medium'
                                      : a.type === 'dispensary' 
                                        ? 'text-purple-700 font-medium' 
                                        : a.type === 'clinic' 
                                          ? 'text-red-600 font-medium'
                                          : a.type === 'management' 
                                            ? 'text-blue-600 font-medium' 
                                            : a.type === 'unavailable' 
                                              ? 'text-gray-600 font-medium' 
                                              : ''
                                  }`}
                                >
                                  {a.type === 'unavailable' 
                                    ? a.location === 'Protected Rota Time' ? 'Protected Time' : 'Unavailable' 
                                    : a.type === 'management' 
                                      ? 'Management Time' 
                                      : a.type.charAt(0).toUpperCase() + a.type.slice(1)}
                                </div>
                              ))
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    }).filter(Boolean); // Remove any null entries from filtered time slots
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowPharmacistReport(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pharmacist Report Controls - Added under the table */}
      {rotaGenerated && (
        <div className="mt-6 mx-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold mb-3 text-gray-800">Pharmacist Schedule Report</h3>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="w-full sm:flex-1">
              <label htmlFor="pharmacist-select" className="block text-sm font-medium text-gray-700 mb-1">
                Select Pharmacist
              </label>
              <select
                id="pharmacist-select"
                value={selectedPharmacistForReport || ''}
                onChange={(e) => setSelectedPharmacistForReport(e.target.value as Id<"pharmacists">)}
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Choose a pharmacist...</option>
                {Array.from(new Set(rotaAssignments
                  .filter(a => a.pharmacistId) 
                  .map(a => a.pharmacistId)
                ))
                .map(pharmacistId => ({
                  id: pharmacistId,
                  pharmacist: pharmacists.find(p => p._id === pharmacistId)
                }))
                .filter(item => item.pharmacist) // Filter out any undefined pharmacists
                .sort((a, b) => {
                  // Sort by displayName or name, case-insensitive
                  const nameA = (a.pharmacist?.displayName || a.pharmacist?.name || '').toLowerCase();
                  const nameB = (b.pharmacist?.displayName || b.pharmacist?.name || '').toLowerCase();
                  return nameA.localeCompare(nameB);
                })
                .map(({ id, pharmacist }) => (
                  <option key={id} value={id}>
                    {pharmacist ? (pharmacist.displayName || pharmacist.name) : 'Unknown'}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => selectedPharmacistForReport && setShowPharmacistReport(true)}
              disabled={!selectedPharmacistForReport}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={!selectedPharmacistForReport ? 'Please select a pharmacist first' : 'View weekly schedule'}
            >
              <span className="flex items-center justify-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                View Weekly Schedule
              </span>
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            View a detailed weekly schedule for the selected pharmacist
          </p>
        </div>
      )}
    </div>
  );
}
