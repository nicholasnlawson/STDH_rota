import React, { useMemo } from 'react';
import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { getTechnicianColor, getContrastColor } from './utils/technicianColors';

interface Assignment {
  category: string;
  date: string;
  endTime: string;
  location: string;
  startTime: string;
  technicianId: string;
  technicianName?: string;
  type: string;
}

interface TechnicianRotaTableViewProps {
  assignments: Assignment[];
  startDate: string; // ISO date string for Monday of the week
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TIME_SLOTS = [
  { start: '09:00', end: '13:00' },
  { start: '13:00', end: '17:00' }
];

export function TechnicianRotaTableView({ assignments, startDate }: TechnicianRotaTableViewProps) {
  // Group assignments by location and date
  const assignmentsByLocation = React.useMemo(() => {
    const locations = new Map<string, Record<string, Assignment[]>>();
    
    assignments.forEach(assignment => {
      if (!locations.has(assignment.location)) {
        locations.set(assignment.location, {});
      }
      
      const locationAssignments = locations.get(assignment.location)!;
      const date = format(parseISO(assignment.date), 'yyyy-MM-dd');
      
      if (!locationAssignments[date]) {
        locationAssignments[date] = [];
      }
      
      locationAssignments[date].push(assignment);
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
  const locations = Array.from(assignmentsByLocation.keys()).sort((a, b) => {
    // Category 5: Management Time (always last)
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
        return 4;
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
            style={{
              flex: `1 0 ${100 / slotAssignments.length}%`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: bgColor,
              color: textColor,
              width: '100%',
              padding: '4px',
              margin: 0,
              fontSize: '13px',
              fontWeight: 500,
              textAlign: 'center',
              lineHeight: '1.4',
              borderBottom: assignmentIndex < slotAssignments.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none',
              overflow: 'visible',
            }}
            title={`${assignment.technicianName || 'Unassigned'} (${assignment.startTime}-${assignment.endTime})`}
          >
            {assignment.technicianName || 'Unassigned'}
          </div>
        );
      })}
    </div>
  ) : null}
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
