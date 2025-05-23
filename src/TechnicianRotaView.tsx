import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { getBankHolidaysInRange, BankHoliday } from "./bankHolidays";
import { parseISO } from 'date-fns'; // Added parseISO import
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { TechnicianSelectionModal } from "./TechnicianSelectionModal";
import { TechnicianReplacementModal } from "./TechnicianReplacementModal"; // Added import
import { TechnicianRotaTableView } from "./TechnicianRotaTableView";

// Add type declarations for custom properties on the window object
declare global {
  interface Window {
    __technicianRotaViewRendered?: boolean;
    __sortedSelectedClinicsLogged?: boolean;
  }
}

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

interface TechnicianRotaViewProps {
  isViewOnly?: boolean;
  isAdmin?: boolean;
  initialSelectedMonday?: string;
  initialRotaAssignments?: any[];
  initialRotaIdsByDate?: Record<string, Id<"technicianRotas">>;
  publishedRota?: {
    _id: Id<"technicianRotas">;
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

export function TechnicianRotaView({
  isViewOnly = false,
  isAdmin = false,
  initialSelectedMonday = "",
  initialRotaAssignments = [],
  initialRotaIdsByDate = {},
  publishedRota = null,
  onEditsChanged
}: TechnicianRotaViewProps = {}) {
  // If user is not an admin and not in a specific view-only mode (like viewing published rotas),
  // set isViewOnly to true to prevent any edits
  const effectiveViewOnly = isViewOnly || !isAdmin;
  const techniciansQuery = useQuery(api.technicians.list) || [];
  const [technicians, setTechnicians] = useState(techniciansQuery);
  const updateTechnician = useMutation(api.technicians.update);
  const publishRota = useMutation(api.technicianRotas.publishRota);
  const saveFreeCellText = useMutation(api.technicianRotas.saveFreeCellText);
  const storeRotaAssignments = useMutation(api.technicianRotas.storeRotaAssignments);
  
  // Update local state when query data changes
  useEffect(() => {
    setTechnicians(techniciansQuery);
  }, [techniciansQuery]);
  const generateWeeklyRota = useMutation(api.technicianRotas.generateWeeklyRota);
  const clinics = useQuery(api.clinics.listClinics) || [];
  const technicianRequirements = useQuery(api.technicianRequirements.listRequirements) || [];
  const convex = useConvex();
  const saveRotaConfiguration = useMutation(api.technicianRotas.saveRotaConfiguration);
  const updateRotaAssignment = useMutation(api.technicianRotas.updateRotaAssignment);
  const updateMultipleAssignments = useMutation(api.technicianRotas.updateMultipleAssignments);
  
  const [selectedClinicIds, setSelectedClinicIds] = useState<Array<Id<"clinics">>>([]);
  const [selectedTechnicianIds, setSelectedTechnicianIds] = useState<Array<Id<"technicians">>>(() => {
    // Preselect default technicians
    return (technicians.filter((t: any) => t.isDefaultTechnician).map((t: any) => t._id) || []);
  });
  
  const [techniciansConfirmed, setTechniciansConfirmed] = useState(false);
  
  // Initialize rotaIdsByDate state from props
  const [rotaIdsByDate, setRotaIdsByDate] = useState<Record<string, Id<"technicianRotas">>>(initialRotaIdsByDate || {});
  
  // Track additional requirements and clinics that need to be fulfilled
  const [additionalRequirements, setAdditionalRequirements] = useState<Array<{
    roleId: string;
    roleName: string;
    days: string[];
  }>>([]);
  
  const [additionalClinics, setAdditionalClinics] = useState<Array<Id<"clinics">>>([]);
  const [rolesConfirmed, setRolesConfirmed] = useState(false);
  const [technicianSearch, setTechnicianSearch] = useState("");
  
  // Filter technicians based on search term and sort them
  const filteredTechnicians = useMemo(() => {
    return (technicians || [])
      .filter((technician: any) => 
        (technician.displayName || technician.name).toLowerCase().includes(technicianSearch.toLowerCase()) ||
        (technician.email?.toLowerCase().includes(technicianSearch.toLowerCase()))
      )
      .sort((a: any, b: any) => {
        // Default technicians first, then sort by name
        if (a.isDefaultTechnician !== b.isDefaultTechnician) {
          return a.isDefaultTechnician ? -1 : 1;
        }
        return (a.displayName || a.name).localeCompare(b.displayName || b.name);
      });
  }, [technicians, technicianSearch]);
  
  const [selectedMonday, setSelectedMonday] = useState(initialSelectedMonday);
  const [generatingWeekly, setGeneratingWeekly] = useState(false);
  const [showClinicSelection, setShowClinicSelection] = useState(false);
  const [showTechnicianSelection, setShowTechnicianSelection] = useState(false);
  const [rotaGenerated, setRotaGenerated] = useState(effectiveViewOnly || false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // State for manual editing
  const [selectedTechnicianCell, setSelectedTechnicianCell] = useState<{
    rotaId: Id<"technicianRotas">;
    assignmentId?: Id<"technicianRotas">; // Or the specific ID type for an assignment if it's different
    assignmentIndex?: number;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
    currentTechnicianId: Id<"technicians"> | null;
    otherTechnicianIds?: Array<Id<"technicians">>;
  } | null>(null);
  const [showTechnicianReplacementModal, setShowTechnicianReplacementModal] = useState(false); // Renamed
  const [draggedTechnicianInfo, setDraggedTechnicianInfo] = useState<{
    technicianId: Id<"technicians">;
    assignment: any; // Consider a more specific type for technician assignment
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [dropTargetTechnicianCellInfo, setDropTargetTechnicianCellInfo] = useState<{
    technicianId: Id<"technicians"> | null;
    assignment: any | null; // Consider a more specific type
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  
  // State to track drag modifiers (e.g., Shift key for full-day swaps)
  const [dragState, setDragState] = useState({
    shiftKeyPressed: false
  });

  // Handler for when a technician assignment cell is clicked in the table
  const handleTechnicianCellClick = useCallback((details: {
    assignment: any; // Should conform to the updated Assignment type with _id and rotaId
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => {
    if (effectiveViewOnly) return;

    console.log("Cell clicked details:", details);
    console.log("Current rotaIdsByDate:", rotaIdsByDate);
    
    // First, try to get the rotaId directly from the assignment if it exists
    let rotaId = details.assignment.rotaId;
    
    // If not available in the assignment, try to get it from rotaIdsByDate
    if (!rotaId) {
      const clickedDate = details.date;
      rotaId = rotaIdsByDate[clickedDate];
      
      // If still not found, check if it's in the published rota
      if (!rotaId && publishedRota && publishedRota.date === clickedDate) {
        rotaId = publishedRota._id;
      }
      
      // If still not found, try to find the closest date's rotaId
      if (!rotaId) {
        console.log(`No direct rotaId found for date ${clickedDate}, looking for closest date`);
        
        // Get all dates that have rotaIds
        const availableDates = Object.keys(rotaIdsByDate).sort();
        if (availableDates.length > 0) {
          // Find the closest date (this is a simple approach - you might want to improve it)
          const closestDate = availableDates[0]; // Default to first date
          rotaId = rotaIdsByDate[closestDate];
          console.log(`Using rotaId from closest date ${closestDate}`);
        } else if (Object.keys(rotaIdsByDate).length === 0) {
          // If rotaIdsByDate is empty, we might need to create rota documents first
          console.error("No rota documents exist yet. Please generate the rota first.");
          alert("Please generate the rota first. This will create draft records that can be edited.");
          return;
        }
      }
    }
    
    if (!rotaId) {
      console.error(`Could not find a valid rotaId for this assignment`);
      return;
    }
    
    // For empty cells or unassigned slots, we might want to handle differently
    // For now, we'll just show the replacement modal for all cells
    const assignmentId = details.assignment._id;
    const currentTechnicianId = details.assignment.technicianId;

    // If this is an empty cell or unassigned slot
    if (!currentTechnicianId || currentTechnicianId === '') {
      console.log("Clicked on empty/unassigned cell:", details);
      // TODO: Implement logic for adding a new assignment to an empty cell
      // For now, we'll just show the replacement modal
    }

    setSelectedTechnicianCell({
      rotaId: rotaId as Id<"technicianRotas">, // Use the found rotaId
      assignmentId: assignmentId as Id<"technicianRotas">, // Assuming assignment ID is also this type, adjust if different
      location: details.location,
      date: details.date,
      startTime: details.startTime,
      endTime: details.endTime,
      currentTechnicianId: currentTechnicianId as Id<"technicians"> || null, // Cast to Id type, allow null for empty cells
    });
    setShowTechnicianReplacementModal(true);
  }, [effectiveViewOnly, rotaIdsByDate, publishedRota]);
  
  // Handler for when a technician cell drag starts
  const handleDragStart = useCallback((details: {
    assignment: any;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => {
    if (effectiveViewOnly) return;
    
    const { assignment, location, date, startTime, endTime } = details;
    if (!assignment.technicianId) return; // Only allow dragging cells with technicians
    
    console.log("Drag started:", details);
    
    setDraggedTechnicianInfo({
      technicianId: assignment.technicianId as Id<"technicians">,
      assignment,
      location,
      date,
      startTime,
      endTime
    });
  }, [effectiveViewOnly]);
  
  // Handler for when a drag is over a potential drop target
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (effectiveViewOnly) return;
    e.preventDefault(); // Necessary to allow dropping
  }, [effectiveViewOnly]);
  
  // Handler for when a drag enters a potential drop target
  const handleDragEnter = useCallback((details: {
    assignment: any | null;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => {
    if (effectiveViewOnly) return;
    
    const { assignment, location, date, startTime, endTime } = details;
    console.log("Drag entered:", details);
    
    setDropTargetTechnicianCellInfo({
      technicianId: assignment?.technicianId as Id<"technicians"> || null,
      assignment,
      location,
      date,
      startTime,
      endTime
    });
  }, [effectiveViewOnly]);
  
  // Handler for when a drag leaves a potential drop target
  const handleDragLeave = useCallback(() => {
    if (effectiveViewOnly) return;
    
    // Optionally clear the drop target info or keep it for visual feedback
    // setDropTargetTechnicianCellInfo(null);
  }, [effectiveViewOnly]);
  
  // Handler for when a technician is dropped on a target cell
  const handleDrop = useCallback(async (details: {
    assignment: any | null;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => {
    if (effectiveViewOnly || !draggedTechnicianInfo) return;
    
    const { assignment: targetAssignment, location, date, startTime, endTime } = details;
    console.log("Drop target:", details);
    console.log("Dragged source:", draggedTechnicianInfo);
    
    // If dropping on the same cell, do nothing
    if (draggedTechnicianInfo.location === location && 
        draggedTechnicianInfo.date === date && 
        draggedTechnicianInfo.startTime === startTime && 
        draggedTechnicianInfo.technicianId === targetAssignment?.technicianId) {
      console.log("Dropped on the same cell, no action needed");
      setDraggedTechnicianInfo(null);
      setDropTargetTechnicianCellInfo(null);
      return;
    }
    
    // Make full-day swaps the default behavior
    // Hold Shift key for slot-level swaps (reverse the logic)
    const isSlotSwap = dragState.shiftKeyPressed;
    const swapScope = isSlotSwap ? "slot" : "day";
    
    console.log(`Swap scope: ${swapScope} (${isSlotSwap ? "Slot-level swap" : "Full-day swap"})`);
    
    if (isSlotSwap) {
      console.log("SLOT SWAP DETECTED - Shift key is pressed");
    } else {
      console.log("FULL DAY SWAP - Default behavior");
    }
    
    // Swap technicians between the two cells
    try {
      await swapTechnicians(
        draggedTechnicianInfo.assignment,
        targetAssignment,
        draggedTechnicianInfo.location,
        location,
        draggedTechnicianInfo.date,
        date,
        draggedTechnicianInfo.startTime,
        startTime,
        swapScope
      );
      console.log(`Technicians swapped successfully with scope: ${swapScope}`);
    } catch (error) {
      console.error("Error swapping technicians:", error);
    }
    
    // Clear drag and drop state
    setDraggedTechnicianInfo(null);
    setDropTargetTechnicianCellInfo(null);
  }, [effectiveViewOnly, draggedTechnicianInfo]);
  
  // Function to swap technicians between two assignments
  const swapTechnicians = async (
    sourceAssignment: any,
    targetAssignment: any | null,
    sourceLocation: string,
    targetLocation: string,
    sourceDate: string,
    targetDate: string,
    sourceStartTime: string,
    targetStartTime: string,
    scope: "slot" | "day" = "slot" // Default to slot for backward compatibility
  ) => {
    if (!sourceAssignment?.technicianId) {
      console.error("Source assignment has no technician");
      return;
    }
    
    const sourceTechnicianId = sourceAssignment.technicianId as Id<"technicians">;
    const targetTechnicianId = targetAssignment?.technicianId as Id<"technicians"> || null;
    const sourceRotaId = sourceAssignment.rotaId as Id<"technicianRotas">;
    const targetRotaId = targetAssignment?.rotaId as Id<"technicianRotas"> || sourceRotaId; // Use source rota ID if target has none
    
    console.log(`Swapping technicians: ${sourceTechnicianId} -> ${targetTechnicianId || 'empty'} and ${targetTechnicianId || 'empty'} -> ${sourceTechnicianId}`);
    console.log(`Swap scope: ${scope}`);
    
    // Handle different swap scopes
    try {
      let sourceResult;
      
      // For full-day swaps, use updateMultipleAssignments
      if (scope === "day") {
        console.log(`Performing full-day swap for date ${sourceDate}`);
        
        // Get the rota IDs for the source and target dates
        const sourceRotaIdFromDate = rotaIdsByDate[sourceDate];
        const targetRotaIdFromDate = rotaIdsByDate[targetDate];
        
        if (!sourceRotaIdFromDate) {
          throw new Error(`No rota ID found for source date ${sourceDate}`);
        }
        
        if (!targetRotaIdFromDate && targetDate !== sourceDate) {
          throw new Error(`No rota ID found for target date ${targetDate}`);
        }
        
        // For the source technician: replace with target technician for the whole day at the source location
        sourceResult = await updateMultipleAssignments({
          rotaIdsByDate: { [sourceDate]: sourceRotaIdFromDate },
          location: sourceLocation, // Only update assignments for this location
          date: sourceDate,
          originalTechnicianId: sourceTechnicianId,
          newTechnicianId: targetTechnicianId || sourceTechnicianId, // If target is empty, keep source technician
          scope: "day",
          respectEAU: true // Respect EAU special rules
        });
      } else {
        // For slot-level swaps, use the original updateRotaAssignment
        sourceResult = await updateRotaAssignment({
          rotaId: sourceRotaId,
          location: sourceLocation,
          startTime: sourceStartTime,
          originalTechnicianId: sourceTechnicianId,
          newTechnicianId: targetTechnicianId || sourceTechnicianId, // If target is empty, keep source technician
        });
      }
      
      console.log("Source assignment updated:", sourceResult);
      
      // Update local state for source assignment
      if (sourceResult && sourceResult.success) {
        setRotaAssignments(prevAssignments => {
          return prevAssignments.map(assignment => {
            // For full-day swaps, update all assignments for this technician at this location on this date
            if (scope === "day" && 
                assignment.location === sourceLocation && 
                assignment.date === sourceDate && 
                assignment.technicianId === sourceTechnicianId) {
              
              console.log(`Updating full-day source assignment in local state: ${JSON.stringify(assignment)}`);
              return {
                ...assignment,
                technicianId: targetTechnicianId || sourceTechnicianId
              };
            }
            // For slot-level swaps, use the original logic
            else if (scope === "slot" && 
                     assignment.location === sourceLocation && 
                     assignment.date === sourceDate && 
                     assignment.technicianId === sourceTechnicianId) {
              
              // For afternoon slots (13:00-17:00)
              if (sourceStartTime === "13:00") {
                if (assignment.startTime === "13:00") {
                  console.log(`Updating afternoon source assignment in local state: ${JSON.stringify(assignment)}`);
                  return {
                    ...assignment,
                    technicianId: targetTechnicianId || sourceTechnicianId
                  };
                }
              } 
              // For morning slots (09:00-13:00)
              else if (sourceStartTime === "09:00") {
                if (assignment.startTime === "09:00" && 
                    (assignment.endTime === "13:00" || assignment.endTime === undefined)) {
                  console.log(`Updating morning source assignment in local state: ${JSON.stringify(assignment)}`);
                  return {
                    ...assignment,
                    technicianId: targetTechnicianId || sourceTechnicianId
                  };
                }
              }
              // For any other time slots
              else if (assignment.startTime === sourceStartTime) {
                return {
                  ...assignment,
                  technicianId: targetTechnicianId || sourceTechnicianId
                };
              }
            }
            return assignment;
          });
        });
      }
      // If target has a technician, update the target assignment
      if (targetTechnicianId) {
        let targetResult;
        
        // For full-day swaps, use updateMultipleAssignments
        if (scope === "day") {
          console.log(`Performing full-day swap for target date ${targetDate}`);
          
          // Get the rota ID for the target date
          const targetRotaIdFromDate = rotaIdsByDate[targetDate];
          
          if (!targetRotaIdFromDate) {
            throw new Error(`No rota ID found for target date ${targetDate}`);
          }
          
          // For the target technician: replace with source technician for the whole day at the target location
          targetResult = await updateMultipleAssignments({
            rotaIdsByDate: { [targetDate]: targetRotaIdFromDate },
            location: targetLocation, // Only update assignments for this location
            date: targetDate,
            originalTechnicianId: targetTechnicianId,
            newTechnicianId: sourceTechnicianId,
            scope: "day",
            respectEAU: true // Respect EAU special rules
          });
        } else {
          // For slot-level swaps, use the original updateRotaAssignment
          targetResult = await updateRotaAssignment({
            rotaId: targetRotaId,
            location: targetLocation,
            startTime: targetStartTime,
            originalTechnicianId: targetTechnicianId,
            newTechnicianId: sourceTechnicianId,
          });
        }
        
        console.log("Target assignment updated:", targetResult);
        
        // Update local state for target assignment
        if (targetResult && targetResult.success) {
          setRotaAssignments(prevAssignments => {
            return prevAssignments.map(assignment => {
              // For full-day swaps, update all assignments for this technician at this location on this date
              if (scope === "day" && 
                  assignment.location === targetLocation && 
                  assignment.date === targetDate && 
                  assignment.technicianId === targetTechnicianId) {
                
                console.log(`Updating full-day target assignment in local state: ${JSON.stringify(assignment)}`);
                return {
                  ...assignment,
                  technicianId: sourceTechnicianId
                };
              }
              // For slot-level swaps, use the original logic
              else if (scope === "slot" && 
                       assignment.location === targetLocation && 
                       assignment.date === targetDate && 
                       assignment.technicianId === targetTechnicianId) {
                
                // For afternoon slots (13:00-17:00)
                if (targetStartTime === "13:00") {
                  if (assignment.startTime === "13:00") {
                    console.log(`Updating afternoon target assignment in local state: ${JSON.stringify(assignment)}`);
                    return {
                      ...assignment,
                      technicianId: sourceTechnicianId
                    };
                  }
                } 
                // For morning slots (09:00-13:00)
                else if (targetStartTime === "09:00") {
                  if (assignment.startTime === "09:00" && 
                      (assignment.endTime === "13:00" || assignment.endTime === undefined)) {
                    console.log(`Updating morning target assignment in local state: ${JSON.stringify(assignment)}`);
                    return {
                      ...assignment,
                      technicianId: sourceTechnicianId
                    };
                  }
                }
                // For any other time slots
                else if (assignment.startTime === targetStartTime) {
                  return {
                    ...assignment,
                    technicianId: sourceTechnicianId
                  };
                }
              }
              return assignment;
            });
          });
        }
      }
      
      // In a real implementation, you might want to modify the mutation to handle this case directly
      if (!targetTechnicianId) {
        // TODO: Implement logic to remove a technician from an assignment
        // For now, we'll just log it
        console.log("Target was empty, source technician should be removed (not implemented yet)");
      }
      
      return true;
    } catch (error) {
      console.error("Error in swapTechnicians:", error);
      throw error;
    }
  };

  // Handler for when a new technician is selected in the replacement modal
  const handleTechnicianReplacementSelect = useCallback(async (newTechnicianId: Id<"technicians">, scope: "slot" | "day" | "week") => {
    if (!selectedTechnicianCell) {
      console.error("No technician cell selected for replacement.");
      return;
    }

    const { rotaId, location, date, startTime, endTime, currentTechnicianId: originalTechnicianId, assignmentId } = selectedTechnicianCell;

    if (!originalTechnicianId) {
      console.error("Original technician ID is missing from selected cell.");
      // This might happen if trying to replace an 'Unassigned' slot, which should be handled by a different logic (e.g., add new assignment)
      // For now, we assume replacement is for an existing technician.
      setShowTechnicianReplacementModal(false);
      setSelectedTechnicianCell(null);
      return;
    }

    // Get a valid rotaId - either from the selectedTechnicianCell or find one
    let effectiveRotaId = rotaId;
    
    if (!effectiveRotaId) {
      console.log("Rota ID is missing from selected cell, attempting to find one.");
      console.log("Selected cell details:", selectedTechnicianCell);
      console.log("Available rotaIdsByDate:", rotaIdsByDate);
      
      // First try to get it from rotaIdsByDate using the date
      if (date) {
        effectiveRotaId = rotaIdsByDate[date];
      }
      
      // If still not found, check if it's in the published rota
      if (!effectiveRotaId && publishedRota && publishedRota.date === date) {
        effectiveRotaId = publishedRota._id;
      }
      
      // If still not found, try to find any rotaId
      if (!effectiveRotaId) {
        const availableDates = Object.keys(rotaIdsByDate).sort();
        if (availableDates.length > 0) {
          // Use the first available rotaId
          const firstDate = availableDates[0];
          effectiveRotaId = rotaIdsByDate[firstDate];
          console.log(`Using rotaId from date ${firstDate} as fallback`);
        }
      }
      
      if (!effectiveRotaId) {
        console.error("Could not find any valid rotaId to use for the update.");
        setShowTechnicianReplacementModal(false);
        setSelectedTechnicianCell(null);
        return;
      }
    }

    console.log(`Attempting to replace technician for Rota ID: ${effectiveRotaId}, Assignment ID (from cell): ${assignmentId}`);
    console.log(`  Original Technician ID: ${originalTechnicianId}`);
    console.log(`  New Technician ID: ${newTechnicianId}`);
    console.log(`  Scope of replacement: ${scope}`);
    console.log(`  Cell details: Location: ${location}, Date: ${date}, StartTime: ${startTime}`);

    try {
      if (scope === "slot") {
        console.log(`Making slot mutation call with rotaId: ${effectiveRotaId}`);
        const result = await updateRotaAssignment({
          rotaId: effectiveRotaId,
          location,
          startTime,
          endTime,
          originalTechnicianId,
          newTechnicianId,
        });
        
        if (result && result.success) {
          console.log("Technician replacement successful for slot:", result);
          
          // Update the local state to reflect the change
          setRotaAssignments(prevAssignments => {
            // First, check if we need to handle a specific half-day slot
            let found = false;
            let updatedAssignments = prevAssignments.map(assignment => {
              // For precise matching of half-day slots
              if (assignment.location === location && 
                  assignment.date === date && 
                  assignment.startTime === startTime &&
                  assignment.endTime === endTime &&
                  assignment.technicianId === originalTechnicianId) {
                
                console.log(`Found exact match for ${startTime}-${endTime} assignment: ${JSON.stringify(assignment)}`);
                found = true;
                return {
                  ...assignment,
                  technicianId: newTechnicianId
                };
              }
              return assignment;
            });
            
            // If we didn't find an exact match, it might be a full-day assignment that was split on the server
            if (!found) {
              console.log(`No exact match found in UI state, looking for full-day assignment`);
              
              // Check if there's a full-day assignment that needs to be updated in the UI
              const fullDayAssignmentIndex = prevAssignments.findIndex(a => 
                a.location === location && 
                a.date === date && 
                a.startTime === "09:00" && 
                (a.endTime === "17:00" || a.endTime === undefined) && 
                a.technicianId === originalTechnicianId
              );
              
              if (fullDayAssignmentIndex !== -1) {
                console.log(`Found full-day assignment in UI that was likely split on server`);
                const fullDayAssignment = prevAssignments[fullDayAssignmentIndex];
                
                // Remove the full-day assignment
                updatedAssignments = [
                  ...updatedAssignments.slice(0, fullDayAssignmentIndex),
                  ...updatedAssignments.slice(fullDayAssignmentIndex + 1)
                ];
                
                // Create morning assignment (9:00-13:00)
                const morningAssignment = {
                  ...fullDayAssignment,
                  startTime: "09:00",
                  endTime: "13:00",
                  technicianId: startTime === "09:00" ? newTechnicianId : fullDayAssignment.technicianId
                };
                
                // Create afternoon assignment (13:00-17:00)
                const afternoonAssignment = {
                  ...fullDayAssignment,
                  startTime: "13:00",
                  endTime: "17:00",
                  technicianId: startTime === "13:00" ? newTechnicianId : fullDayAssignment.technicianId
                };
                
                // Add both half-day assignments
                updatedAssignments.push(morningAssignment, afternoonAssignment);
                console.log(`Split into half-day assignments in UI: Morning: ${JSON.stringify(morningAssignment)}, Afternoon: ${JSON.stringify(afternoonAssignment)}`);
              } else {
                // If we're still not finding a match, try a more general search for the assignment
                console.log(`No full-day assignment found, trying a more general search`);
                
                // For morning slots (09:00), only update morning assignments
                if (startTime === "09:00") {
                  updatedAssignments = updatedAssignments.map(assignment => {
                    if (assignment.location === location && 
                        assignment.date === date && 
                        assignment.startTime === "09:00" &&
                        assignment.technicianId === originalTechnicianId) {
                      
                      console.log(`Found morning assignment to update: ${JSON.stringify(assignment)}`);
                      return {
                        ...assignment,
                        endTime: "13:00", // Ensure it's marked as a morning slot
                        technicianId: newTechnicianId
                      };
                    }
                    return assignment;
                  });
                }
                // For afternoon slots (13:00), only update afternoon assignments
                else if (startTime === "13:00") {
                  updatedAssignments = updatedAssignments.map(assignment => {
                    if (assignment.location === location && 
                        assignment.date === date && 
                        assignment.startTime === "13:00" &&
                        assignment.technicianId === originalTechnicianId) {
                      
                      console.log(`Found afternoon assignment to update: ${JSON.stringify(assignment)}`);
                      return {
                        ...assignment,
                        startTime: "13:00",
                        endTime: "17:00", // Ensure it's marked as an afternoon slot
                        technicianId: newTechnicianId
                      };
                    }
                    return assignment;
                  });
                }
              }
            }
            
            return updatedAssignments;
          });
        } else {
          console.warn("Technician replacement for slot might have failed or no assignment was updated:", result);
          // TODO: Provide user feedback for failure
        }
      } 
      // Handle day scope - replace all assignments for this technician on this day
      else if (scope === "day") {
        console.log(`Making day-scope mutation call for date: ${date}`);
        
        // For day scope, we need to update all assignments for this technician on this date
        const result = await updateMultipleAssignments({
          rotaIdsByDate: { [date]: effectiveRotaId },
          location, // Optional - if provided, only update assignments for this location
          date,
          originalTechnicianId,
          newTechnicianId,
          scope: "day",
          respectEAU: true // Respect EAU special rules
        });
        
        if (result && result.success) {
          console.log("Technician replacement successful for day:", result);
          
          // Update the local state to reflect all changes for this day
          setRotaAssignments(prevAssignments => {
            return prevAssignments.map(assignment => {
              // Match all assignments for this technician on this day
              // If location is provided, only update assignments for that location
              if (assignment.date === date && 
                  assignment.technicianId === originalTechnicianId &&
                  (!location || assignment.location === location)) {
                
                console.log(`Updating assignment for day scope: ${JSON.stringify(assignment)}`);
                return {
                  ...assignment,
                  technicianId: newTechnicianId
                };
              }
              return assignment;
            });
          });
        } else {
          console.warn("Technician replacement for day might have failed:", result);
          // TODO: Provide user feedback for failure
        }
      }
      // Handle week scope - replace all assignments for this technician across the week
      else if (scope === "week") {
        console.log(`Making week-scope mutation call for week starting: ${date}`);
        
        // For week scope, we need to update all assignments for this technician across all days
        const result = await updateMultipleAssignments({
          rotaIdsByDate,
          location, // Optional - if provided, only update assignments for this location
          date, // Still need to provide a date for reference
          originalTechnicianId,
          newTechnicianId,
          scope: "week",
          respectEAU: true // Respect EAU special rules
        });
        
        if (result && result.success) {
          console.log("Technician replacement successful for week:", result);
          
          // Update the local state to reflect all changes across the week
          setRotaAssignments(prevAssignments => {
            return prevAssignments.map(assignment => {
              // Match all assignments for this technician across all days
              // If location is provided, only update assignments for that location
              if (assignment.technicianId === originalTechnicianId &&
                  (!location || assignment.location === location)) {
                
                console.log(`Updating assignment for week scope: ${JSON.stringify(assignment)}`);
                return {
                  ...assignment,
                  technicianId: newTechnicianId
                };
              }
              return assignment;
            });
          });
        } else {
          console.warn("Technician replacement for week might have failed:", result);
          // TODO: Provide user feedback for failure
        }
      } else {
        console.warn(`Unknown scope "${scope}" for technician replacement.`);
      }
    } catch (error) {
      console.error(`Error updating technician assignment for ${scope}:`, error);
      // TODO: Provide user feedback for error
    }

    // Close modal and clear selection after handling
    setShowTechnicianReplacementModal(false);
    setSelectedTechnicianCell(null);
  }, [selectedTechnicianCell, updateRotaAssignment, rotaIdsByDate, publishedRota]); // Added updateRotaAssignment to dependency array if it's used directly

  // Helper function to get day index (0=Monday, 1=Tuesday, etc.)
  const getDayIndex = useCallback((dayName: string): number => {
    const dayMap: Record<string, number> = {
      'monday': 0,
      'tuesday': 1,
      'wednesday': 2,
      'thursday': 3,
      'friday': 4,
      'saturday': 5,
      'sunday': 6
    };
    return dayMap[dayName.toLowerCase()] ?? 0;
  }, []);

  // Sort clinics by day of the week and then by start time
  const sortedClinics = useMemo(() => {
    return [...clinics].sort((a: { dayOfWeek: string | number, startTime: string }, b: { dayOfWeek: string | number, startTime: string }) => {
      // Helper function to get day name in lowercase
      const getDayName = (day: string | number): string => {
        if (typeof day === 'number') {
          return DAYS[day]?.toLowerCase() || '';
        }
        return day.toLowerCase();
      };
      
      // First sort by day of the week
      const dayA = getDayName(a.dayOfWeek);
      const dayB = getDayName(b.dayOfWeek);
      const dayDiff = getDayIndex(dayA) - getDayIndex(dayB);
      if (dayDiff !== 0) return dayDiff;
      
      // If same day, sort by start time
      return a.startTime.localeCompare(b.startTime);
    });
  }, [clinics, getDayIndex]);
  
  // Track current user for tracking metadata when publishing
  const [currentUser, setCurrentUser] = useState<{name: string, email: string}>(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : { name: 'Unknown User', email: '' };
  });
  
  // Create rota documents for days that have assignments but no corresponding rota IDs
  const createMissingRotaDocuments = async () => {
    console.log("Creating missing rota documents for assignments...");
    
    if (rotaAssignments.length === 0) {
      console.log("No assignments to store");
      return rotaIdsByDate;
    }
    
    try {
      // Use the storeRotaAssignments function to create all the necessary rota documents in one call
      console.log(`Storing ${rotaAssignments.length} assignments for week starting ${selectedMonday}`);
      const result = await storeRotaAssignments({
        assignments: rotaAssignments,
        weekStartDate: selectedMonday
      });
      
      console.log("Stored rota assignments, received IDs:", result.rotaIdsByDate);
      
      // Merge any existing rota IDs with the new ones
      const newRotaIdsByDate = { ...rotaIdsByDate, ...result.rotaIdsByDate };
      
      // Update the rotaIdsByDate state with the new rota IDs
      if (Object.keys(newRotaIdsByDate).length > Object.keys(rotaIdsByDate).length) {
        console.log("Setting updated rotaIdsByDate:", newRotaIdsByDate);
        setRotaIdsByDate(newRotaIdsByDate);
        return newRotaIdsByDate;
      }
      
      return result.rotaIdsByDate;
    } catch (error) {
      console.error("Error storing rota assignments:", error);
      return rotaIdsByDate;
    }
  };
  
  // Handler for publishing rota
  const handlePublishRota = async () => {
    setIsPublishing(true);
    try {
      console.log("Starting publish process...");
      console.log("Current rotaIdsByDate:", rotaIdsByDate);
      console.log("Current rotaAssignments length:", rotaAssignments.length);
      
      // We'll use this variable to keep track of the latest rota IDs,
      // regardless of whether they come from state or from createMissingRotaDocuments
      let currentRotaIdsByDate = {...rotaIdsByDate};
      
      // Check if we have assignments but no rota IDs
      if (Object.keys(currentRotaIdsByDate).length === 0 && rotaAssignments.length > 0) {
        console.log("We have assignments but no rota IDs - attempting to create missing rota documents");
        const updatedRotaIdsByDate = await createMissingRotaDocuments();
        
        // If we still don't have any rota IDs, show an error
        if (Object.keys(updatedRotaIdsByDate).length === 0) {
          alert("Unable to publish rota: Failed to create the necessary rota documents. Please try regenerating the rota.");
          setIsPublishing(false);
          return;
        }
        
        // Update our local variable with the fresh rota IDs
        currentRotaIdsByDate = updatedRotaIdsByDate;
        console.log("Using freshly created rota IDs:", currentRotaIdsByDate);
      }
      
      // Get the IDs for all rotas in the current week using our local variable
      const rotaIds = Object.values(currentRotaIdsByDate);
      console.log("Rota IDs to publish:", rotaIds);
      
      if (rotaIds.length === 0) {
        console.log("No rota IDs found to publish");
        
        // Check if we have any assignments at all
        if (rotaAssignments.length === 0) {
          alert("No rotas to publish: No assignments have been generated for this week.");
        } else {
          alert("No rotas to publish: Technical issue - assignments exist but no rota documents were created.");
        }
        
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
        
        // Different formats depending on the cell type:
        // 1. type-location-YYYY-MM-DD-start-end
        // 2. unavailable-YYYY-MM-DD-start-end (no location part)
        
        const parts = key.split('-');
        
        if (key.startsWith('unavailable-')) {
          // Extract date for unavailable format: type-YYYY-MM-DD-start-end
          if (parts.length >= 4) {
            dateStr = `${parts[1]}-${parts[2]}-${parts[3]}`;
          }
        } else {
          // Extract date for other formats: type-location-YYYY-MM-DD-start-end
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
          await saveFreeCellText({
            rotaId,
            freeCellText: textByDate[rotaDate]
          });
          console.log(`Saved free cell text for rota ${rotaId} (${rotaDate}):`, textByDate[rotaDate]);
        }
      }
      
      // Now publish the entire week's rotas
      const firstRotaId = rotaIds[0];
      // Format user information to include both name and email if available
      let userName = 'Unknown User';
      if (currentUser.name && currentUser.email) {
        userName = `${currentUser.name} (${currentUser.email})`;
      } else if (currentUser.name) {
        userName = currentUser.name;
      } else if (currentUser.email) {
        userName = currentUser.email;
      }
      
      console.log(`Publishing rota with user: ${userName}`);
      const result = await publishRota({ 
        rotaId: firstRotaId,
        userName,
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

  // Effect to handle user info changes from localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      const storedUser = localStorage.getItem('user');
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
  
  // Effect to track keyboard modifiers for drag and drop operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setDragState(prev => ({ ...prev, shiftKeyPressed: true }));
        console.log('Shift key pressed - Single slot swap mode enabled');
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setDragState(prev => ({ ...prev, shiftKeyPressed: false }));
        console.log('Shift key released - Full day swap mode (default)');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  // State variables
  const [freeCellText, setFreeCellText] = useState<Record<string, string>>({});
  const [technicianWorkingDays, setTechnicianWorkingDays] = useState<Record<string, string[]>>({});
  const [selectedWeekdays, setSelectedWeekdays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [selectedTechnicianForReport, setSelectedTechnicianForReport] = useState<Id<"technicians"> | null>(null);
  const [showTechnicianReport, setShowTechnicianReport] = useState(false);
  // rotaIdsByDate is already declared at the top of the component
  const [rotaAssignments, setRotaAssignments] = useState<any[]>(initialRotaAssignments || []);
  const [weekdaysConfirmed, setWeekdaysConfirmed] = useState<boolean>(false);
  
  // Get bank holidays for the selected week
  const bankHolidays = useMemo(() => {
    if (!selectedMonday) return [];
    
    try {
      const startDate = new Date(selectedMonday);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6); // End of week
      
      return getBankHolidaysInRange(startDate, endDate);
    } catch (error) {
      console.error('Error getting bank holidays:', error);
      return [];
    }
  }, [selectedMonday]);
  
  // Update selected weekdays to exclude bank holidays
  useEffect(() => {
    if (bankHolidays.length === 0 || !selectedMonday) return;
    
    const holidayDates = bankHolidays.map((h: BankHoliday) => h.date);
    const weekdaysToExclude = new Set<string>();
    
    // For each day in the week, check if it's a bank holiday
    for (let i = 0; i < 5; i++) { // Only weekdays (0-4 = Monday-Friday)
      const date = new Date(selectedMonday);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      if (holidayDates.includes(dateStr)) {
        const dayName = DAYS[date.getDay()];
        weekdaysToExclude.add(dayName);
      }
    }
    
    // Update selected weekdays to exclude bank holidays
    setSelectedWeekdays(prev => {
      const newWeekdays = prev.filter(day => !weekdaysToExclude.has(day));
      return newWeekdays.length > 0 ? newWeekdays : prev;
    });
  }, [bankHolidays, selectedMonday]);
  
  // Helper to check if a date is a Monday
  const isMonday = (date: Date): boolean => {
    return date.getDay() === 1; // 1 is Monday (0 is Sunday)
  };
  
  // Ensure the selected date is always a Monday
  useEffect(() => {
    if (selectedMonday) {
      const date = new Date(selectedMonday);
      if (!isMonday(date)) {
        // If the selected date is not a Monday, adjust it to the next Monday
        const nextMonday = new Date(date);
        nextMonday.setDate(date.getDate() + ((1 + 7 - date.getDay()) % 7));
        setSelectedMonday(nextMonday.toISOString().split('T')[0]);
      }
    }
  }, [selectedMonday]);
  
  // Query to get all rotas
  const allRotas = useQuery(api.technicianRotas.listRotas, { status: effectiveViewOnly ? "published" : "draft" }) || [];
  
  // Pre-select all clinics with includeByDefaultInRota
  useEffect(() => {
    if (clinics.length > 0 && selectedClinicIds.length === 0) {
      // Pre-select all clinics with includeByDefaultInRota === true
      const defaultClinicIds = clinics
        .filter((c: any) => c.includeByDefaultInRota)
        .map((c: any) => c._id);
      setSelectedClinicIds(defaultClinicIds);
    }
  }, [clinics, selectedClinicIds.length]);
  
  // Helper to check if a date corresponds to a deselected weekday or bank holiday
  const isDeselectedDay = useCallback((date: Date): boolean => {
    try {
      const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayLabel = dayLabels[date.getDay()];
      const isoDate = date.toISOString().split('T')[0];
      
      // Check if it's a bank holiday
      const isHoliday = bankHolidays.some(holiday => holiday.date === isoDate);
      
      // If it's a bank holiday, it should be deselected
      if (isHoliday) return true;
      
      // For weekends, always deselect them
      if (dayLabel === "Saturday" || dayLabel === "Sunday") return true;
      
      // For weekdays, check if they're in the selected weekdays
      return !selectedWeekdays.includes(dayLabel);
      
    } catch (error) {
      console.error('[isDeselectedDay] Error determining if day is deselected:', error);
      return false; // Default to included if there's an error
    }
  }, [bankHolidays, selectedWeekdays]);
  
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
  
  // Define time slots
  const TIME_SLOTS = [
    { start: "09:00", end: "11:00" },
    { start: "11:00", end: "13:00" },
    { start: "13:00", end: "15:00" },
    { start: "15:00", end: "17:00" },
  ];
  
  // Get Monday of the week containing the given date
  const getMondayOfWeek = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
      const monday = new Date(date.setDate(diff));
      return monday.toISOString().split('T')[0];
    } catch (e) {
      console.error('Error parsing date:', e);
      return '';
    }
  };
  
  // When selectedMonday changes, fetch bank holidays
  useEffect(() => {
    const fetchBankHolidays = async () => {
      if (!selectedMonday) return;
      
      try {
        // Logic to fetch bank holidays if needed
      } catch (error) {
        console.error('Error fetching bank holidays:', error);
      }
    };
    
    fetchBankHolidays();
  }, [selectedMonday]);
  
  // Export rota to PDF
  const exportToPDF = useCallback(async () => {
    const rotaTableElement = document.querySelector('.min-w-full'); // Target the main table
    if (!rotaTableElement) {
      console.error('Rota table element not found');
      return;
    }

    // Show loading indicator
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';
    
    // Use the week date for the filename
    const weekDateStr = new Date(selectedMonday).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    
    try {
      // Create a style element with CSS to fix cell height issues
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        table { border-collapse: collapse; width: 100%; }
        th, td { 
          padding: 0 !important; 
          height: 48px !important; 
          min-height: 48px !important;
          overflow: visible !important;
          box-sizing: border-box !important;
        }
        td > div {
          display: flex !important;
          flex-direction: column !important;
          height: 100% !important;
          width: 100% !important;
          overflow: visible !important;
        }
        td > div > div {
          flex: 1 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 4px !important;
          font-size: 13px !important;
          line-height: 1.4 !important;
          overflow: visible !important;
        }
      `;
      
      // Capture the table as an image with high quality settings
      const canvas = await html2canvas(rotaTableElement as HTMLElement, {
        scale: 3, // Higher scale for better text quality
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: true,
        allowTaint: true,
        onclone: (clonedDoc) => {
          // Add our fix styles to the cloned document
          clonedDoc.head.appendChild(styleEl);
          
          // Remove any emoji panels or popups
          const overlays = clonedDoc.querySelectorAll('.emoji-picker, .popup, .menu, .dropdown');
          overlays.forEach(overlay => {
            if (overlay.parentNode) {
              overlay.parentNode.removeChild(overlay);
            }
          });
          
          // Ensure all cells have proper styling
          const cells = clonedDoc.querySelectorAll('td');
          cells.forEach(cell => {
            const cellEl = cell as HTMLElement;
            cellEl.style.height = '48px';
            cellEl.style.minHeight = '48px';
            cellEl.style.padding = '0';
            cellEl.style.overflow = 'visible';
            cellEl.style.boxSizing = 'border-box';
            
            // Make sure all assignment divs are properly styled
            const assignmentDivs = cellEl.querySelectorAll('div > div');
            assignmentDivs.forEach(div => {
              const divEl = div as HTMLElement;
              divEl.style.display = 'flex';
              divEl.style.alignItems = 'center';
              divEl.style.justifyContent = 'center';
              divEl.style.overflow = 'visible';
              divEl.style.padding = '4px';
              divEl.style.margin = '0';
              divEl.style.boxSizing = 'border-box';
              divEl.style.fontSize = '13px';
              divEl.style.lineHeight = '1.4';
            });
          });
        }
      });
      
      // Create the PDF in landscape orientation
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Calculate dimensions to fit the table properly
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min((pdfWidth - 20) / imgWidth, (pdfHeight - 40) / imgHeight);
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 30;
      
      // Add title
      pdf.setFontSize(18);
      pdf.text(`Technician Rota - Week of ${weekDateStr}`, pdfWidth / 2, 15, { align: 'center' });
      
      // Add subtitle with generation info
      pdf.setFontSize(12);
      pdf.text(`Generated on ${new Date().toLocaleDateString()}`, pdfWidth / 2, 22, { align: 'center' });
      
      // Add the rota table image
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);
      
      // Save the PDF
      pdf.save(`technician_rota_${selectedMonday}.pdf`);
      
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error exporting PDF. Please try again.');
    } finally {
      // Reset cursor
      document.body.style.cursor = originalCursor;
    }
  }, [selectedMonday]);
  
  // Generate dates for the week based on the selected Monday
  const weekDates = useMemo(() => {
    if (!selectedMonday) return [];
    
    try {
      const mondayDate = new Date(selectedMonday);
      const dates = [];
      
      // Generate 7 days starting from Monday
      for (let i = 0; i < 7; i++) {
        const date = new Date(mondayDate);
        date.setDate(mondayDate.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);
      }
      
      return dates;
    } catch (e) {
      console.error('Error generating week dates:', e);
      return [];
    }
  }, [selectedMonday]);
  

  
  // Generate date display headers
  const renderDateHeaders = () => {
    return weekDates.map((dateString, index) => {
      try {
        const date = new Date(dateString);
        const dayName = DAYS[date.getDay()];
        const formattedDate = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        
        // Determine if this is a deselected day
        const isDeselected = isDeselectedDay(date);
        
        return (
          <th 
            key={dateString} 
            className={`px-4 py-2 border border-gray-300 ${isDeselected ? 'bg-gray-200' : ''}`}
          >
            <div className="font-semibold">{dayName}</div>
            <div className="text-sm">{formattedDate}</div>
          </th>
        );
      } catch (e) {
        console.error('Error rendering date header:', e);
        return <th key={index} className="px-4 py-2 border border-gray-300">Error</th>;
      }
    });
  };
  
  // Get the next Monday from today
  const getNextMonday = (): string => {
    // Return a date far in the past to allow selecting any Monday
    // Using 2020-01-06 (a Monday) as a reasonable start date
    return '2020-01-06';
  };

  // Handle date change - ensures only Mondays can be selected and loads draft rotas if available
  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = e.target.value;
    const date = new Date(selectedDate);
    
    // If the selected date is not a Monday, adjust it to the next Monday
    if (date.getDay() !== 1) {
      const nextMonday = new Date(date);
      nextMonday.setDate(date.getDate() + ((1 + 7 - date.getDay()) % 7));
      setSelectedMonday(nextMonday.toISOString().split('T')[0]);
      return;
    }
    
    // Set the selected Monday date
    setSelectedMonday(selectedDate);
    
    // Check for existing draft rotas for this week
    if (!effectiveViewOnly) {
      try {
        console.log('Checking for draft rotas for week starting:', selectedDate);
        const draftRotaData = await convex.query(api.technicianRotas.getDraftRotasForWeek, {
          weekStartDate: selectedDate
        });
        
        if (draftRotaData && 
            (Object.keys(draftRotaData.rotaIdsByDate).length > 0 || 
             draftRotaData.assignments.length > 0)) {
          console.log('Found draft rotas for selected week:', draftRotaData);
          setRotaIdsByDate(draftRotaData.rotaIdsByDate);
          setRotaAssignments(draftRotaData.assignments);
          setRotaGenerated(true);
          
          // Show notification to user
          const notification = document.createElement('div');
          notification.className = 'fixed bottom-4 right-4 bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 rounded shadow-lg';
          notification.style.zIndex = '9999';
          notification.innerHTML = `
            <div class="flex items-center">
              <div class="py-1"><svg class="fill-current h-6 w-6 text-blue-500 mr-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z"/></svg></div>
              <div>
                <p class="font-bold">Most recent draft rota loaded</p>
                <p class="text-sm">The most recent draft rota for this week has been loaded. You can edit it or click 'Create Rota' to generate a new one.</p>
              </div>
              <div class="ml-4">
                <button id="close-notification" class="text-blue-500 hover:text-blue-700">×</button>
              </div>
            </div>
          `;
          document.body.appendChild(notification);
          
          // Remove notification after 5 seconds or when close button is clicked
          setTimeout(() => {
            if (document.body.contains(notification)) {
              document.body.removeChild(notification);
            }
          }, 5000);
          
          document.getElementById('close-notification')?.addEventListener('click', () => {
            if (document.body.contains(notification)) {
              document.body.removeChild(notification);
            }
          });
        } else {
          console.log('No draft rotas found for selected week');
        }
      } catch (error) {
        console.error('Error fetching draft rotas:', error);
      }
    }
  };
  
  // Get the minimum date for the date picker (next Monday)
  const minDate = getNextMonday();
  
  // Toggle weekday selection
  const toggleWeekday = (day: string) => {
    setSelectedWeekdays(prev => {
      if (prev.includes(day)) {
        return prev.filter(d => d !== day);
      } else {
        return [...prev, day];
      }
    });
  };
  
  // When selectedMonday changes, fetch bank holidays
  useEffect(() => {
    const fetchBankHolidays = async () => {
      if (!selectedMonday) return;
      
      try {
        // Logic to fetch bank holidays if needed
      } catch (error) {
        console.error('Error fetching bank holidays:', error);
      }
    };
    
    fetchBankHolidays();
  }, [selectedMonday]);
  
  // Generate weekly technician rota
useEffect(() => {
  if (clinics.length > 0 && selectedClinicIds.length === 0) {
    // Pre-select all clinics with includeByDefaultInRota === true
    const defaultClinicIds = clinics.filter(c => c.includeByDefaultInRota).map(c => c._id);
    setSelectedClinicIds(defaultClinicIds);
  }
}, [clinics, selectedClinicIds.length]);

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

  // Filter and sort clinics for display
  return clinics
    .filter((c: any) => clinicIdsToUse.includes(c._id))
    .sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime));
}, [clinics, rotaAssignments, selectedClinicIds, effectiveViewOnly, isDeselectedDay]);

// Generate weekly technician rota
const generateWeeklyTechnicianRota = async () => {
  if (!selectedMonday || selectedTechnicianIds.length === 0) {
    alert('Please select a week and at least one technician before generating the rota.');
    return;
  }

  setGeneratingWeekly(true);
  
  try {
    // Clear any existing draft rotas for this week before generating new ones
    console.log('Clearing existing draft rotas for week starting:', selectedMonday);
    await convex.mutation(api.technicianRotas.clearDraftRotasForWeek, {
      weekStartDate: selectedMonday
    });
  } catch (error) {
    console.error('Error clearing existing draft rotas:', error);
    // Continue with generation even if clearing fails
  }

  try {
    // Create a map of technician IDs to their working days
    const workingDaysMap = technicians.reduce((acc, tech) => {
      if (selectedTechnicianIds.includes(tech._id)) {
        acc[tech._id] = tech.workingDays || [];
      }
      return acc;
    }, {} as Record<string, string[]>);
    
    // Save the current rota configuration for future reference
    if (!effectiveViewOnly) {
      await saveRotaConfiguration({
        weekStartDate: selectedMonday,
        technicianIds: selectedTechnicianIds,
        selectedWeekdays: selectedWeekdays,
        // Temporarily removing workingDays parameter until server-side validation is fixed
        // workingDays: workingDaysMap,
        includeWarfarinClinics: true // Allow warfarin clinics to be included for technicians
      });
    }
    
    // Call the backend API to generate the rota
    console.log('=== START: Processing Additional Roles ===');
    console.log('Initial additionalRequirements:', JSON.stringify(additionalRequirements, null, 2));
    
    // Extract just the role names for each day
    // We'll store the role information in localStorage for the backend to use
    const rolesByDay: Record<string, string[]> = {};
    
    // Initialize all days with empty arrays
    const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    allDays.forEach(day => rolesByDay[day] = []);
    
    // Process each additional requirement
    console.log('\nProcessing each requirement:');
    additionalRequirements.forEach((requirement, reqIdx) => {
      console.log(`\nRequirement ${reqIdx + 1}:`, {
        roleName: requirement.roleName,
        days: requirement.days || []
      });
      
      // For each day the requirement is active
      (requirement.days || []).forEach(day => {
        if (!rolesByDay[day]) {
          console.warn(`Warning: Invalid day '${day}' found in requirement`);
          return;
        }
        console.log(`  - Adding to ${day} roles`);
        rolesByDay[day].push(requirement.roleName);
      });
    });
    
    // Log the final roles by day
    console.log('\nFinal roles by day:');
    Object.entries(rolesByDay).forEach(([day, roles]) => {
      if (roles.length > 0) {
        console.log(`  ${day}:`, roles);
      }
    });
    
    // Store the rolesByDay information in localStorage
    localStorage.setItem('technicianRolesByDay', JSON.stringify(rolesByDay));
    console.log('\nStored roles by day in localStorage');
    
    console.log('\n=== PROCESSING SELECTED WEEKDAYS ===');
    console.log('Selected weekdays:', selectedWeekdays);
    
    // Filter additional roles to only include those for days that are selected
    const filteredRolesByDay: Record<string, { roleId: string, roleName: string }[]> = {};
    selectedWeekdays.forEach(day => {
      filteredRolesByDay[day] = [];
    });

    additionalRequirements.forEach((req: { roleId: string; roleName: string; days: string[] }) => {
      req.days.forEach(day => {
        if (selectedWeekdays.includes(day) && filteredRolesByDay[day]) {
          // Store the full role object
          filteredRolesByDay[day].push({ roleId: req.roleId, roleName: req.roleName });
        }
      });
    });

    console.log('\n=== FRONTEND: FILTERED ROLES BY DAY ===');
    console.log('Roles being sent to backend (full map):', JSON.stringify(filteredRolesByDay, null, 2));
    
    // Now we'll send the full 'filteredRolesByDay' map as 'additionalRolesByDay'
    console.log('\n=== SENDING TO BACKEND ===');
    
    const result = await generateWeeklyRota({
      startDate: selectedMonday,
      technicianIds: selectedTechnicianIds,
      selectedWeekdays: selectedWeekdays,
      workingDays: workingDaysMap,
      additionalRolesByDay: filteredRolesByDay,
      selectedClinicIds: selectedClinicIds, // Pass the selected clinic IDs
      ignoredUnavailableRules: {technicianId: "", ruleIndices: []},
      includeWarfarinClinics: true // This flag will be secondary if selectedClinicIds is populated
    });
      
      if (result) {
        console.log('Debug - Received rota IDs:', result);
        
        // Handle case where result is an array of rota IDs
        if (Array.isArray(result)) {
          // Create a new object to store rota IDs by date
          const newRotaIdsByDate: Record<string, Id<"technicianRotas">> = {};
          let allAssignments: any[] = [];
          
          // Fetch all rotas in parallel
          const fetchAllRotas = async () => {
            setGeneratingWeekly(true);
            
            try {
              // Create date strings for the week
              const weekDateStrings: string[] = [];
              for (let i = 0; i < 7; i++) {
                const dateObj = new Date(selectedMonday);
                dateObj.setDate(dateObj.getDate() + i);
                weekDateStrings.push(dateObj.toISOString().split('T')[0]);
              }
              
              // Fetch each rota and collect assignments
              const rotaPromises = result.map(async (rotaId, index) => {
                if (!rotaId) return null;
                
                try {
                  const dateString = weekDateStrings[index];
                  newRotaIdsByDate[dateString] = rotaId as Id<"technicianRotas">;
                  
                  // Fetch the rota details
                  const rota = await convex.query(api.technicianRotas.getRota, { 
                    rotaId: rotaId as Id<"technicianRotas"> 
                  });
                  
                  console.log(`Debug - Fetched rota for ${dateString}:`, rota);
                  
                  if (rota) {
                    console.log(`Debug - Rota assignments for ${dateString}:`, rota.assignments);
                    
                    if (rota.assignments && Array.isArray(rota.assignments)) {
                      // Add date to each assignment
                      const assignmentsWithDate = rota.assignments.map((a: any) => {
                        console.log(`Debug - Processing assignment:`, a);
                        return {
                          ...a,
                          date: dateString
                        };
                      });
                      
                      console.log(`Debug - Processed assignments for ${dateString}:`, assignmentsWithDate);
                      return assignmentsWithDate;
                    } else {
                      console.log(`Debug - No assignments array for ${dateString} or not an array`, rota.assignments);
                    }
                  } else {
                    console.log(`Debug - No rota found for ${dateString}`);
                  }
                } catch (error) {
                  console.error('Error fetching rota:', error);
                }
                
                return [];
              });
              
              const assignmentsArrays = await Promise.all(rotaPromises);
              
              // Flatten the array of arrays
              allAssignments = assignmentsArrays.flat().filter(Boolean);
              
              console.log('Debug - Fetched assignments:', allAssignments);
              console.log('Debug - Rota IDs by date:', newRotaIdsByDate);
              
              // Update state
              setRotaIdsByDate(newRotaIdsByDate);
              setRotaAssignments(allAssignments);
              // Only set rotaGenerated to true if there are actual assignments or rota IDs
              if (allAssignments.length > 0 || Object.keys(newRotaIdsByDate).length > 0) {
                setRotaGenerated(true);
              } else {
                setRotaGenerated(false); // Explicitly set to false
                alert("Rota generation completed, but no assignments were made for the selected week. Nothing to display or publish.");
              }
            } catch (error) {
              console.error('Error fetching rotas:', error);
              alert('Error loading rota data. Please try again.');
            } finally {
              setGeneratingWeekly(false);
            }
          };
          
          fetchAllRotas();
        } 
        // Handle case where result is already in the expected format
        else if (typeof result === 'object') {
          const rotaData = result as unknown as {
            rotaIdsByDate: Record<string, Id<"technicianRotas">>;
            assignments: any[];
          };
          
          console.log('Debug - Rota data as object:', rotaData);
          console.log('Debug - Assignments:', rotaData.assignments);
          
          setRotaIdsByDate(rotaData.rotaIdsByDate || {});
          setRotaAssignments(rotaData.assignments || []);
          // Apply similar logic here
          if ((rotaData.assignments && rotaData.assignments.length > 0) || 
              (rotaData.rotaIdsByDate && Object.keys(rotaData.rotaIdsByDate).length > 0)) {
            setRotaGenerated(true);
          } else {
            setRotaGenerated(false);
            alert("Rota generation completed, but no assignments were made for the selected week. Nothing to display or publish.");
          }
        }
      }
    } catch (error) {
      console.error('Error generating weekly rota:', error);
      alert('Error generating rota. Please try again.');
    } finally {
      setGeneratingWeekly(false);
    }
  };
  
  // Render the main technician rota view
  return (
    <div className="bg-white rounded-lg shadow p-6 w-full">
      <h2 className="text-2xl font-semibold mb-6">Technician Rota Management</h2>
      
      {!effectiveViewOnly && (
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
            <h3 className="text-lg font-medium mb-4">Step 1: Select Week</h3>
            <div className="mb-4">
              <label className="block font-medium mb-1">Select Monday (week start)</label>
              <input
                type="date"
                className="border rounded px-2 py-1"
                value={selectedMonday}
                onChange={handleDateChange}
                min={minDate}
                step="7"
              />
              <p className="text-xs text-gray-500 mt-1">Only Mondays can be selected</p>
              
              {selectedMonday && (
                <div className="mt-4">
                  <h3 className="font-medium mb-2">Select Weekdays to Include in Rota</h3>
                  <p className="text-sm text-gray-600 mb-2">Deselect days for bank holidays or other special circumstances.</p>
                  <div className="flex flex-wrap gap-3 mb-4">
                    {CLINIC_DAY_LABELS.map((day) => {
                      // Check if this weekday has any bank holidays during the selected week
                      const dayIndex = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(day);
                      const hasHoliday = selectedMonday && bankHolidays.some((h: BankHoliday) => {
                        const holidayDate = new Date(h.date);
                        return holidayDate.getDay() === dayIndex;
                      });
                      
                      // Get the holiday name if available
                      const holidayInfo = hasHoliday ? bankHolidays.find((h: BankHoliday) => {
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
                          onClick={() => toggleWeekday(day)}
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
                    type="button"
                    className={`py-2 px-4 rounded font-medium mt-4 transition-colors ${
                      weekdaysConfirmed 
                        ? 'bg-green-600 hover:bg-green-700 text-white' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    } ${selectedWeekdays.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => {
                      if (weekdaysConfirmed) {
                        // If already confirmed, just update the confirmation
                        setWeekdaysConfirmed(false);
                      } else if (selectedWeekdays.length > 0) {
                        // If not confirmed and has selections, confirm
                        setWeekdaysConfirmed(true);
                      }
                    }}
                    disabled={selectedWeekdays.length === 0}
                  >
                    {weekdaysConfirmed ? '✓ Weekdays Confirmed - Click to Edit' : 'Confirm Weekdays'}
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
            <h3 className="text-lg font-medium mb-4">Step 2: Additional Roles</h3>
            <div className="mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {technicianRequirements.filter((role: any) => role.category === 'Pharmacy & Dispensary').map((role: any) => (
                  <div key={role._id || role.name} className="bg-gray-50 p-3 rounded border border-gray-200">
                    <label className="flex items-center font-medium mb-2">
                      <input
                        type="checkbox"
                        checked={rotaAssignments.some(a => 
                          a.type === "role" && a.roleId === (role._id || role.name)
                        )}
                        onChange={(e) => {
                          let updatedAssignments = [...rotaAssignments];
                          const currentRoleId = role._id || role.name;

                          if (e.target.checked) {
                            // First, remove any existing assignments for this specific role
                            updatedAssignments = updatedAssignments.filter(a => 
                              !(a.type === "role" && a.roleId === currentRoleId)
                            );

                            // Then, add the default assignments for this role (Mon-Fri, if in selectedWeekdays)
                            CLINIC_DAY_LABELS.forEach((dayLabel, index) => {
                              if (selectedWeekdays.includes(dayLabel)) {
                                const dateForDay = weekDates[index]; 
                                if (dateForDay) {
                                  // Check if it already exists (shouldn't, due to filter above, but as safeguard)
                                  const exists = updatedAssignments.some(a => 
                                    a.type === "role" && 
                                    a.roleId === currentRoleId && 
                                    a.date === dateForDay
                                  );
                                  if (!exists) {
                                    updatedAssignments.push({
                                      type: "role",
                                      roleId: currentRoleId,
                                      roleName: role.name,
                                      date: dateForDay,
                                      technicianId: null 
                                    });
                                  }
                                }
                              }
                            });
                          } else {
                            // Remove all assignments for this role
                            updatedAssignments = updatedAssignments.filter(a => 
                              !(a.type === "role" && a.roleId === currentRoleId)
                            );
                          }
                          setRotaAssignments(updatedAssignments);
                        }}
                        className="mr-2"
                      />
                      {role.name}
                    </label>
                    <div className="pl-6">
                      <p className="text-xs text-gray-500 mb-1">Select days:</p>
                      <div className="flex flex-wrap gap-2">
                        {CLINIC_DAY_LABELS.map(day => (
                          <label key={`${role._id || role.name}-${day}`} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={rotaAssignments.some(a => {
                                if (a.type === "role" && a.roleId === (role._id || role.name) && a.date) {
                                  try {
                                    const assignmentDate = parseISO(a.date);
                                    const assignmentDayName = DAYS[assignmentDate.getDay()];
                                    return assignmentDayName === day;
                                  } catch (error) {
                                    console.error("Error parsing date in assignment for checked state:", a.date, error);
                                    return false;
                                  }
                                }
                                return false;
                              })}
                              onChange={(e) => {
                                const newAssignments = [...rotaAssignments];
                                const clinicLabelIndex = CLINIC_DAY_LABELS.indexOf(day);

                                if (clinicLabelIndex >= 0 && weekDates[clinicLabelIndex]) {
                                  const dateForDay = weekDates[clinicLabelIndex];
                                  if (e.target.checked) {
                                    const exists = newAssignments.some(a => 
                                      a.type === "role" && 
                                      a.roleId === (role._id || role.name) && 
                                      a.date === dateForDay
                                    );
                                    if (!exists) {
                                      newAssignments.push({
                                        type: "role",
                                        roleId: role._id || role.name,
                                        roleName: role.name,
                                        date: dateForDay,
                                        technicianId: null
                                      });
                                    }
                                  } else {
                                    const idx = newAssignments.findIndex(a => 
                                      a.type === "role" && 
                                      a.roleId === (role._id || role.name) && 
                                      a.date === dateForDay
                                    );
                                    if (idx >= 0) {
                                      newAssignments.splice(idx, 1);
                                    }
                                  }
                                  setRotaAssignments(newAssignments);
                                }
                              }}
                              className="mr-1"
                            />
                            <span className="text-xs">{day}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="mb-4">
              <h4 className="text-md font-medium mb-2">Clinics</h4>
              <div className="flex items-center mb-2">
                <button
                  onClick={() => setShowClinicSelection(!showClinicSelection)}
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded border border-blue-200 flex items-center"
                >
                  <span className="mr-2">{selectedClinicIds.length} Clinics Selected</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              
              {showClinicSelection && (
                <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-3">
                  <div className="max-h-48 overflow-y-auto">
                    {sortedClinics.map((clinic: any) => (
                      <label key={clinic._id} className="flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={selectedClinicIds.includes(clinic._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedClinicIds([...selectedClinicIds, clinic._id]);
                            } else {
                              setSelectedClinicIds(selectedClinicIds.filter(id => id !== clinic._id));
                            }
                          }}
                          className="mr-2"
                        />
                        <span className="flex items-center">
                          <span className="font-medium">{clinic.name}</span>
                          <span className="text-xs text-gray-500 ml-2">
                            {typeof clinic.dayOfWeek === 'number' ? DAYS[clinic.dayOfWeek] : clinic.dayOfWeek} {clinic.startTime}-{clinic.endTime}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              
              <button
                type="button"
                className={`py-2 px-4 rounded-md font-medium ${
                  rolesConfirmed 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
                onClick={() => {
                  // Store the current selections with actual selected days per role
                  const selectedRoles = technicianRequirements
                    .filter((role: any) => 
                      rotaAssignments.some(a => 
                        a.type === "role" && a.roleId === (role._id || role.name)
                      )
                    )
                    .map((role: any) => {
                      // Get unique days this role is assigned to
                      const roleDays = Array.from(new Set(
                        rotaAssignments
                          .filter((a: any) => 
                            a.type === "role" && 
                            a.roleId === (role._id || role.name) &&
                            a.date
                          )
                          .map((a: any) => {
                            const date = new Date(a.date);
                            return DAYS[date.getDay()];
                          })
                      ));
                      
                      console.log(`Role ${role.name} is assigned to days:`, roleDays);
                      
                      return {
                        roleId: role._id || role.name,
                        roleName: role.name,
                        days: roleDays
                      };
                    });
                  
                  setAdditionalRequirements(selectedRoles);
                  setAdditionalClinics([...selectedClinicIds]);
                  setRolesConfirmed(!rolesConfirmed);
                }}
              >
                {rolesConfirmed ? '✓ Requirements Confirmed - Click to Edit' : 'Save Additional Rota Requirements'}
              </button>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
            <h3 className="text-lg font-medium mb-4">Step 3: Select Technicians</h3>
            
            <div className="mb-4">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search technicians..."
                  value={technicianSearch}
                  onChange={(e) => setTechnicianSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                />
              </div>
              
              <div className="space-y-4 max-h-[400px] overflow-y-auto p-2">
                {filteredTechnicians.map((technician) => (
                  <div key={technician._id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedTechnicianIds.includes(technician._id)}
                          onChange={() => {
                            if (selectedTechnicianIds.includes(technician._id)) {
                              setSelectedTechnicianIds(selectedTechnicianIds.filter(id => id !== technician._id));
                            } else {
                              setSelectedTechnicianIds([...selectedTechnicianIds, technician._id]);
                            }
                          }}
                          className="h-4 w-4 text-blue-600 rounded mr-2"
                        />
                        <span className="font-medium">
                          {technician.displayName || technician.name}
                          {technician.isDefaultTechnician && (
                            <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-2">
                      <div className="text-sm text-gray-600 mb-1">Working days:</div>
                      <div className="flex flex-wrap gap-1">
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => {
                          const isWorkingDay = technician.workingDays?.includes(day) ?? false;
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={async () => {
                                // Create a deep copy of the current technicians array
                                const updatedTechnicians = JSON.parse(JSON.stringify(technicians));
                                
                                // Find the technician and update their working days
                                const techIndex = updatedTechnicians.findIndex((t: any) => t._id === technician._id);
                                if (techIndex !== -1) {
                                  const tech = updatedTechnicians[techIndex];
                                  const workingDays = [...(tech.workingDays || [])];
                                  const dayIndex = workingDays.indexOf(day);
                                  
                                  if (dayIndex > -1) {
                                    // Remove the day if it exists
                                    workingDays.splice(dayIndex, 1);
                                  } else {
                                    // Add the day if it doesn't exist
                                    workingDays.push(day);
                                    workingDays.sort((a: string, b: string) => {
                                      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                                      return days.indexOf(a) - days.indexOf(b);
                                    });
                                  }
                                  
                                  // Update the technician's working days
                                  tech.workingDays = workingDays;
                                  
                                  try {
                                    // Update the database
                                    await updateTechnician({
                                      id: tech._id,
                                      workingDays: workingDays
                                    });
                                    
                                    // Update local state only after successful DB update
                                    setTechnicians(updatedTechnicians);
                                  } catch (error) {
                                    console.error('Failed to update technician:', error);
                                    // Revert the UI if the update fails
                                    setTechnicians([...technicians]);
                                  }
                                }
                              }}
                              className={`text-xs px-2 py-1 rounded ${
                                isWorkingDay 
                                  ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' 
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {day.slice(0, 3)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Click days to toggle availability
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6">
                <button
                  onClick={() => setTechniciansConfirmed(!techniciansConfirmed)}
                  className={`px-4 py-2 rounded-md font-medium ${
                    techniciansConfirmed 
                      ? 'bg-green-600 text-white hover:bg-green-700' 
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {techniciansConfirmed ? '✓ Technicians Confirmed - Click to Edit' : 'Save Technicians'}
                </button>
              </div>
              
              {/* Duplicate Rota Generation Days section removed */}
            </div>
          </div>
          
          <div className="flex gap-4">
            <button
              onClick={generateWeeklyTechnicianRota}
              disabled={generatingWeekly || !selectedMonday || selectedTechnicianIds.length === 0}
              className={`px-4 py-2 rounded font-medium text-white ${
                generatingWeekly || !selectedMonday || selectedTechnicianIds.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {generatingWeekly ? 'Generating...' : 'Generate Rota'}
            </button>
            
            {rotaGenerated && (
              <>
                <button
                  onClick={exportToPDF}
                  className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700"
                >
                  Export PDF
                </button>
                
                {isAdmin && (
                  <button
                    onClick={handlePublishRota}
                    disabled={isPublishing}
                    className={`ml-2 px-4 py-2 rounded font-medium ${isPublishing ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                  >
                    {isPublishing ? 'Publishing...' : 'Publish Rota'}
                  </button>
                )}
                
                {publishSuccess && (
                  <span className="ml-2 text-green-600 font-medium">
                    ✓ Rota published successfully!
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
      
      {selectedMonday && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold">Week of {new Date(selectedMonday).toLocaleDateString()}</h3>
            
            {/* Add PDF Export button in both view-only and edit modes when there are assignments */}
            {rotaAssignments.length > 0 && (
              <button
                onClick={exportToPDF}
                className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700"
              >
                Export PDF
              </button>
            )}
          </div>
          
          {rotaAssignments.length > 0 && (
            <div className="mt-6">
              <h4 className="text-lg font-medium mb-3">Technician Rota</h4>
              <TechnicianRotaTableView 
                assignments={rotaAssignments.map(a => ({
                  ...a,
                  technicianName: technicians.find(t => t._id === a.technicianId)?.displayName || 
                                 technicians.find(t => t._id === a.technicianId)?.name ||
                                 'Unassigned'
                }))} 
                startDate={selectedMonday} 
                isViewOnly={!isAdmin} // Set to false for admin users to enable interactivity
                onTechnicianAssignmentClick={handleTechnicianCellClick}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            </div>
          )}
        </div>
      )}
      
      {!selectedMonday && (
        <div className="text-center py-10 text-gray-500">
          Please select a week to view or generate a rota.
        </div>
      )}
      
      {/* Add the TechnicianSelectionModal - only shown when not in view-only mode */}
      {!effectiveViewOnly && (
        <TechnicianSelectionModal
          isOpen={showTechnicianSelection}
          onClose={() => setShowTechnicianSelection(false)}
          onSelectTechnicians={(technicianIds) => {
            setSelectedTechnicianIds(technicianIds);
            setShowTechnicianSelection(false);
          }}
          selectedTechnicianIds={selectedTechnicianIds}
        />
      )}
      
      {/* Add the TechnicianReplacementModal */}
      {showTechnicianReplacementModal && selectedTechnicianCell && (
        <TechnicianReplacementModal
          isOpen={showTechnicianReplacementModal}
          onClose={() => {
            setShowTechnicianReplacementModal(false);
            setSelectedTechnicianCell(null);
          }}
          onSelect={handleTechnicianReplacementSelect} // Pass the handler
          currentTechnicianId={selectedTechnicianCell.currentTechnicianId}
          location={selectedTechnicianCell.location}
          date={selectedTechnicianCell.date}
          time={`${selectedTechnicianCell.startTime}-${selectedTechnicianCell.endTime}`}
        />
      )}
      
      {/* Visual indicator for slot-level swap mode */}
      {dragState.shiftKeyPressed && draggedTechnicianInfo && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
          </svg>
          <span className="font-bold">SINGLE SLOT SWAP MODE</span>
        </div>
      )}
    </div>
  );
}
