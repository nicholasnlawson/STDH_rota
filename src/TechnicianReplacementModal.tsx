import { Id } from "../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

interface TechnicianReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (technicianId: Id<"technicians"> | null, scope: "slot" | "day" | "week") => void;
  currentTechnicianId: Id<"technicians"> | null;
  location: string;
  date: string; // Added date for context
  time: string; // Added time for context
}

export function TechnicianReplacementModal({
  isOpen,
  onClose,
  onSelect,
  currentTechnicianId,
  location,
  date,
  time
}: TechnicianReplacementModalProps) {
  const technicians = useQuery(api.technicians.list) || [];
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedScope, setSelectedScope] = useState<"slot" | "day" | "week">("slot");

  if (!isOpen) return null;

  // Filter technicians based on search term, then sort alphabetically by name
  const filteredTechnicians = technicians
    .filter(t => 
      (t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (t.displayName && t.displayName.toLowerCase().includes(searchTerm.toLowerCase())))
      // Future: Add logic to filter out technicians who are already assigned elsewhere at this time/date
    )
    .sort((a, b) => {
      const nameA = (a.displayName || a.name).toLowerCase();
      const nameB = (b.displayName || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Handle the selection of a technician or the clearing of an assignment
  const handleSelect = (technicianId: Id<"technicians"> | null) => {
    onSelect(technicianId, selectedScope);
    onClose(); // Close modal after selection
  };

  // Special handler for clearing assignments
  const handleClear = () => {
    onSelect(null, selectedScope);
    onClose(); // Close modal after clearing
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Select Replacement Technician</h2>
            <p className="text-sm text-gray-600 mt-1">For: {location} ({date} {time})</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search technicians..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setSelectedScope("slot")}
            className={`px-3 py-1 rounded-lg text-sm ${selectedScope === "slot" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            This Slot Only
          </button>
          <button
            onClick={() => setSelectedScope("day")}
            className={`px-3 py-1 rounded-lg text-sm ${selectedScope === "day" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            Entire Day
          </button>
          <button
            onClick={() => setSelectedScope("week")}
            className={`px-3 py-1 rounded-lg text-sm ${selectedScope === "week" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            Entire Week
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Clear assignment option */}
          <div className="mb-4 border-b pb-3">
            <button
              onClick={handleClear}
              className="w-full text-left p-3 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <div>
                <div className="font-medium text-red-700">Clear Assignment</div>
                <div className="text-sm text-red-600">
                  {selectedScope === "week" ? 
                    "Remove technician from all slots this week" : 
                    "Remove technician from all slots on this day"}
                </div>
                {selectedScope === "slot" && (
                  <div className="text-xs text-red-500 mt-1">
                    <span className="font-bold">Note:</span> Clearing affects the entire day, not just this time slot
                  </div>
                )}
              </div>
            </button>
          </div>
          
          <h3 className="font-medium text-gray-700 mb-2">Select Replacement Technician</h3>
          <div className="space-y-2">
            {filteredTechnicians.map((technician) => (
              <button
                key={technician._id}
                onClick={() => handleSelect(technician._id)}
                className={`w-full text-left p-3 rounded-lg hover:bg-gray-100 ${
                  currentTechnicianId === technician._id ? 'bg-blue-50 ring-2 ring-blue-500' : ''
                } ${
                  technician._id === currentTechnicianId ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                disabled={technician._id === currentTechnicianId}
              >
                <div className="font-medium">{technician.displayName || technician.name}</div>
                <div className="text-sm text-gray-500">
                  {technician.primaryWards && technician.primaryWards.length > 0 
                    ? technician.primaryWards.join(', ') 
                    : 'No primary ward'}
                  {/* Add more relevant info like 'Already on shift elsewhere' if available */}
                </div>
              </button>
            ))}
            {filteredTechnicians.length === 0 && (
              <p className="text-center text-gray-500 py-4">No technicians match your search or are available.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
