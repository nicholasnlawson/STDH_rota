import React, { useMemo, useState } from 'react';
import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { getTechnicianColor, getContrastColor } from './utils/technicianColors';


interface Assignment {
  _id: string; // Unique ID for the assignment itself
  rotaId: string; // ID of the parent rota document
  category: string;
  date: string;
  endTime: string;
  location: string;
  startTime: string;
  technicianId: string;
  technicianName?: string;
  technicianBand?: string; // Added to support Student Technicians
  originalLocation?: string; // Added to track original location for Student Technicians
  type: string;
}

interface TechnicianRotaTableViewProps {
  assignments: Assignment[];
  startDate: string; // ISO date string for Monday of the week
  isViewOnly?: boolean; // Added to control interactivity
  onTechnicianAssignmentClick?: (details: {
    assignment: Assignment;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void; // Added for click-to-replace
  onDragStart?: (details: {
    assignment: Assignment;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (details: {
    assignment: Assignment | null;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
  onDragLeave?: () => void;
  onDrop?: (details: {
    assignment: Assignment | null;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TIME_SLOTS = [
  { start: '09:00', end: '13:00' },
  { start: '13:00', end: '17:00' }
];

export function TechnicianRotaTableView({ 
  assignments, 
  startDate, 
  isViewOnly = false, 
  onTechnicianAssignmentClick,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop
}: TechnicianRotaTableViewProps) {
  // Use the debug utility to check if a technician is a student
  // This function is imported from StudentTechnicianDebug.ts

  // Group assignments by location and date, with special handling for Student Technicians
  const [allLoadedLocations] = useState<Set<string>>(() => {
    // Initialize with the special locations that should always be present
    return new Set(['Management Time', 'Students', 'Education/Training']);
  });
  
  const assignmentsByLocation = useMemo(() => {
    const locations = new Map<string, Record<string, Assignment[]>>();
    
    // First, add all previously seen locations to preserve them even when all assignments are cleared
    allLoadedLocations.forEach((location: string) => {
      if (!locations.has(location)) {
        locations.set(location, {});
      }
    });
    
    // Add the Management Time location if it doesn't exist
    if (!locations.has('Management Time')) {
      locations.set('Management Time', {});
    }
    
    // Add the Students location if it doesn't exist
    if (!locations.has('Students')) {
      locations.set('Students', {});
    }
    
    // Add the Education/Training location if it doesn't exist
    if (!locations.has('Education/Training')) {
      locations.set('Education/Training', {});
    }
    
    assignments.forEach(assignment => {
      // Determine where to place this assignment
      let targetLocation = assignment.location;
      
      // If this is a Student Technician and they haven't been manually assigned elsewhere,
      // For student technicians, respect their assigned location
      // If they're assigned to a location other than 'Students', keep them there
      // Otherwise, put them in the 'Students' row
      if (assignment.technicianBand === 'Student') {
        targetLocation = assignment.location !== 'Students' ? assignment.location : 'Students';
      }
      
      // Track this location to preserve it even when all assignments are cleared
      allLoadedLocations.add(targetLocation);
      
      // Ensure the location exists in our map
      if (!locations.has(targetLocation)) {
        locations.set(targetLocation, {});
      }
      
      const locationAssignments = locations.get(targetLocation)!;
      const date = format(parseISO(assignment.date), 'yyyy-MM-dd');
      
      if (!locationAssignments[date]) {
        locationAssignments[date] = [];
      }
      
      locationAssignments[date].push({
        ...assignment,
        // Store the original location for Student Technicians
        originalLocation: assignment.technicianBand === 'Student' && assignment.location !== 'Students' ? 
          assignment.location : undefined
      });
    });
    
    return locations;
  }, [assignments]);

  // Generate dates for the week (Monday to Friday)
  const weekDates = React.useMemo(() => {
    const monday = parseISO(startDate);
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  }, [startDate]);

  // Group assignments by time slot for each location and date
  const getAssignmentsForSlot = (location: string, date: Date, timeSlot: { start: string; end: string }) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const locationAssignments = assignmentsByLocation.get(location);
    
    if (!locationAssignments || !locationAssignments[dateStr]) {
      return [];
    }
    
    return locationAssignments[dateStr].filter(assignment => {
      return (
        (assignment.startTime <= timeSlot.start && assignment.endTime > timeSlot.start) ||
        (assignment.startTime < timeSlot.end && assignment.endTime >= timeSlot.end) ||
        (assignment.startTime >= timeSlot.start && assignment.endTime <= timeSlot.end)
      );
    });
  };

  const getWardNumber = (location: string): number | null => {
    const match = location.match(/^Ward\s+(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  };

  // Get unique locations and sort them in the specified order
  // Create a separate entry for Students if not already present
if (!assignmentsByLocation.has('Students')) {
  assignmentsByLocation.set('Students', {});
}

const locations = Array.from(assignmentsByLocation.keys()).sort((a, b) => {
    // Special categories that are always positioned at the end
    // Category 6: Students (third to last)
    if (a === 'Students') return 1;
    if (b === 'Students') return -1;
    
    // Category 7: Education/Training (second to last)
    if (a === 'Education/Training') return 1;
    if (b === 'Education/Training') return -1;
    
    // Category 8: Management Time (always last)
    if (a === 'Management Time') return 1;
    if (b === 'Management Time') return -1;

    const getLocationPriority = (location: string): number => {
        const lowerLoc = location.toLowerCase();
        // Category 1: Wards (includes "Ward X", "Emergency Assessment Unit", or anything with "ward" in it)
        if (lowerLoc.includes('ward') || lowerLoc.includes('emergency assessment unit')) {
            return 1;
        }
        // Category 2: Dispensary
        if (lowerLoc.includes('dispensary')) {
            return 2;
        }
        // Category 3: Clinics & Pharmacy
        if (lowerLoc.includes('clinic') || lowerLoc.includes('pharm')) {
            return 3;
        }
        // Category 4: Other
        if (lowerLoc === 'students') {
            return 5; // Students category (will be positioned after Other)
        }
        if (lowerLoc === 'education/training') {
            return 6; // Education/Training category (positioned after Students)
        }
        if (lowerLoc === 'management time') {
            return 7; // Management Time (always last)
        }
        return 4; // Other categories
    };

    const priorityA = getLocationPriority(a);
    const priorityB = getLocationPriority(b);

    if (priorityA !== priorityB) {
        return priorityA - priorityB; // Sort by main category priority
    }

    // If in the same priority group:
    if (priorityA === 1) { // Both are 'Wards'
        const aWardNum = getWardNumber(a);
        const bWardNum = getWardNumber(b);

        if (aWardNum !== null && bWardNum !== null) { // Both are numbered "Ward X"
            return aWardNum - bWardNum; // Sort numerically
        }
        if (aWardNum !== null) { // 'a' is "Ward X", 'b' is a named ward (e.g., EAU)
            return -1; // Numbered wards come before named wards
        }
        if (bWardNum !== null) { // 'b' is "Ward X", 'a' is a named ward (e.g., EAU)
            return 1;  // Named wards come after numbered wards
        }
        // Both are named wards (e.g., EAU vs. Maternity Ward), sort alphabetically
        return a.localeCompare(b);
    }

    // For other same-priority groups (Dispensary, Clinics, Other), sort alphabetically
    return a.localeCompare(b);
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-300 border-collapse">
        <colgroup>
          <col key="location-col" className="w-48" />
        </colgroup>
        <thead>
          <tr className="h-8">
            <th className="border p-1 bg-gray-100 sticky left-0 z-10">Location</th>
            {weekDates.map((date, idx) => (
              <th key={date.toISOString()} colSpan={TIME_SLOTS.length} className="border p-1 bg-gray-100 text-center">
                <div className="font-semibold text-sm">{DAYS[idx]}</div>
                <div className="text-xs">{format(date, 'MMM d')}</div>
              </th>
            ))}
          </tr>
          <tr className="h-6">
            <th className="border p-1 bg-gray-100 sticky left-0 z-10"></th>
            {weekDates.flatMap(date => 
              TIME_SLOTS.map((slot, slotIdx) => (
                <th key={`${date.toISOString()}-${slotIdx}`} className="border p-1 bg-gray-50 text-xs text-center">
                  {slot.start}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {locations.map(location => (
            <tr key={location} className="hover:bg-gray-50" style={{ height: '3rem' }}>
              <td className="border p-1 font-medium sticky left-0 bg-white text-sm whitespace-nowrap">
                {location}
              </td>
              {weekDates.map(date => (
                <React.Fragment key={date.toISOString()}>
                  {TIME_SLOTS.map((slot, slotIdx) => {
                    const slotAssignments = getAssignmentsForSlot(location, date, slot);
                    return (
                      <td
                        key={`${location}-${date.toISOString()}-${slotIdx}`}
                        className="border"
                        style={{
                          height: '3rem',
                          minWidth: '6rem',
                          padding: 0,
                          margin: 0,
                          verticalAlign: 'middle',
                          position: 'relative',
                          backgroundColor: '#ffffff',
                          overflow: 'visible',
                          boxSizing: 'border-box',
                        }}
                      >
                        {slotAssignments.length > 0 ? (
                          <div 
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              width: '100%',
                              height: '100%',
                              margin: 0,
                              padding: 0,
                              overflow: 'visible',
                              boxSizing: 'border-box',
                            }}
                          >
                            {slotAssignments.map((assignment, assignmentIndex) => {
                              const bgColor = assignment.technicianId ? getTechnicianColor(assignment.technicianId) : '#f3f4f6';
                              const textColor = assignment.technicianId ? getContrastColor(bgColor) : '#4b5563';
                              const uniqueKey = `${assignment.technicianId || 'unassigned'}-${assignment.startTime}-${assignment.endTime}-${assignmentIndex}`;
                              
                              return (
                                <div 
                                  key={uniqueKey}
                                  className={`technician-cell-content print-table-cell ${!isViewOnly ? 'cursor-pointer hover:opacity-80' : ''}`}
                                  style={{
                                    backgroundColor: bgColor,
                                    color: textColor,
                                    padding: '0.2rem 0.3rem', 
                                    margin: assignmentIndex > 0 ? '1px 0 0 0' : '0', 
                                    borderRadius: '0.2rem',
                                    fontSize: '0.7rem', 
                                    fontWeight: 500,
                                    textAlign: 'center',
                                    width: '100%',
                                    minHeight: '1.5em', 
                                    display: 'flex', // Only for screen; print CSS will override
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxSizing: 'border-box',
                                    lineHeight: '1.1',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap', 
                                    flexGrow: 1,
                                    flexShrink: 0,
                                    flexBasis: `${100 / slotAssignments.length}%`,
                                    /* Enhanced PDF-compatible centering */
                                    position: 'relative',
                                    verticalAlign: 'middle',
                                  }}
                                  draggable={!isViewOnly && !!assignment.technicianId}
                                  onDragStart={(e) => {
                                    if (!isViewOnly && onDragStart && assignment.technicianId) {
                                      onDragStart({
                                        assignment,
                                        location,
                                        date: format(date, 'yyyy-MM-dd'),
                                        startTime: slot.start,
                                        endTime: slot.end,
                                      });
                                    }
                                  }}
                                  onDragOver={(e) => {
                                    if (!isViewOnly && onDragOver) {
                                      e.preventDefault(); // Necessary to allow dropping
                                      onDragOver(e);
                                    }
                                  }}
                                  onDragEnter={(e) => {
                                    if (!isViewOnly && onDragEnter) {
                                      e.preventDefault();
                                      onDragEnter({
                                        assignment,
                                        location,
                                        date: format(date, 'yyyy-MM-dd'),
                                        startTime: slot.start,
                                        endTime: slot.end,
                                      });
                                    }
                                  }}
                                  onDragLeave={(e) => {
                                    if (!isViewOnly && onDragLeave) {
                                      onDragLeave();
                                    }
                                  }}
                                  onDrop={(e) => {
                                    if (!isViewOnly && onDrop) {
                                      e.preventDefault();
                                      onDrop({
                                        assignment,
                                        location,
                                        date: format(date, 'yyyy-MM-dd'),
                                        startTime: slot.start,
                                        endTime: slot.end,
                                      });
                                    }
                                  }}
                                  onClick={() => {
                                    if (!isViewOnly && onTechnicianAssignmentClick) {
                                      onTechnicianAssignmentClick({
                                        assignment,
                                        location,
                                        date: format(date, 'yyyy-MM-dd'),
                                        startTime: slot.start,
                                        endTime: slot.end,
                                      });
                                    }
                                  }}
                                >
                                  {assignment.location === 'Students' && assignment.originalLocation
                                    ? `${assignment.technicianName || 'Student'} (${assignment.originalLocation})` 
                                    : (assignment.technicianName || assignment.technicianId || 'Unassigned')}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div 
                            className={`w-full h-full flex items-center justify-center text-gray-400 ${!isViewOnly ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                            onDragOver={(e) => {
                              if (!isViewOnly && onDragOver) {
                                e.preventDefault(); // Necessary to allow dropping
                                onDragOver(e);
                              }
                            }}
                            onDragEnter={(e) => {
                              if (!isViewOnly && onDragEnter) {
                                e.preventDefault();
                                onDragEnter({
                                  assignment: null,
                                  location,
                                  date: format(date, 'yyyy-MM-dd'),
                                  startTime: slot.start,
                                  endTime: slot.end,
                                });
                              }
                            }}
                            onDragLeave={(e) => {
                              if (!isViewOnly && onDragLeave) {
                                onDragLeave();
                              }
                            }}
                            onDrop={(e) => {
                              if (!isViewOnly && onDrop) {
                                e.preventDefault();
                                onDrop({
                                  assignment: null,
                                  location,
                                  date: format(date, 'yyyy-MM-dd'),
                                  startTime: slot.start,
                                  endTime: slot.end,
                                });
                              }
                            }}
                            onClick={() => {
                              if (!isViewOnly && onTechnicianAssignmentClick) { 
                                // For empty cells, we can pass a null assignment or create a placeholder
                                const emptyAssignment: Assignment = {
                                  _id: '',
                                  rotaId: '',
                                  technicianId: '',
                                  category: '',
                                  date: format(date, 'yyyy-MM-dd'),
                                  location,
                                  startTime: slot.start,
                                  endTime: slot.end,
                                  type: 'empty'
                                };
                                
                                onTechnicianAssignmentClick({
                                  assignment: emptyAssignment,
                                  location,
                                  date: format(date, 'yyyy-MM-dd'),
                                  startTime: slot.start,
                                  endTime: slot.end,
                                });
                              }
                            }}
                          >
                            {/* Optionally, show a '+' icon or similar for adding new assignments */}
                            {!isViewOnly && "+"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </React.Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
