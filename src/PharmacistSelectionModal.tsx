import { Id } from "../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState, useEffect } from "react";

interface PharmacistSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pharmacistId: Id<"pharmacists">, scope: "slot" | "day" | "week") => void;
  onSelectMultiple?: (pharmacistIds: Id<"pharmacists">[], scope: "slot" | "day" | "week", removedPharmacistIds?: Id<"pharmacists">[]) => void;
  currentPharmacistId: Id<"pharmacists"> | null;
  location: string;
  allowMultipleSelection?: boolean;
  existingPharmacistIds?: Id<"pharmacists">[];
}

export function PharmacistSelectionModal({ 
  isOpen, 
  onClose, 
  onSelect, 
  onSelectMultiple,
  currentPharmacistId, 
  location,
  allowMultipleSelection = false,
  existingPharmacistIds = []
}: PharmacistSelectionModalProps) {
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedScope, setSelectedScope] = useState<"slot" | "day" | "week">("slot");
  const [selectedPharmacistIds, setSelectedPharmacistIds] = useState<Id<"pharmacists">[]>([]);
  const [initialPharmacistIds, setInitialPharmacistIds] = useState<Id<"pharmacists">[]>([]);
  
  // Initialize selected pharmacists when the modal opens
  useEffect(() => {
    let initialIds: Id<"pharmacists">[] = [];
    
    // If there are existing pharmacists in this cell, add them
    if (existingPharmacistIds && existingPharmacistIds.length > 0) {
      initialIds = [...existingPharmacistIds];
    }
    
    // Also add the current pharmacist if provided and not already included
    if (currentPharmacistId && !initialIds.includes(currentPharmacistId)) {
      initialIds.push(currentPharmacistId);
    }
    
    setSelectedPharmacistIds(initialIds);
    setInitialPharmacistIds(initialIds);
  }, [currentPharmacistId, existingPharmacistIds]);

  if (!isOpen) return null;

  // Filter pharmacists based on search term, then sort alphabetically by name
  const filteredPharmacists = pharmacists
    .filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (p.displayName && p.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      // Use displayName if available, otherwise fall back to name
      const nameA = (a.displayName || a.name).toLowerCase();
      const nameB = (b.displayName || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const handleSelect = (pharmacistId: Id<"pharmacists">) => {
    if (!allowMultipleSelection) {
      // Single selection mode
      onSelect(pharmacistId, selectedScope);
      onClose();
    } else {
      // Toggle selection in multiple selection mode
      setSelectedPharmacistIds(prev => {
        if (prev.includes(pharmacistId)) {
          return prev.filter(id => id !== pharmacistId);
        } else {
          return [...prev, pharmacistId];
        }
      });
    }
  };
  
  const handleConfirmMultipleSelection = () => {
    if (onSelectMultiple) {
      // Find pharmacists that were initially selected but now deselected
      const removedPharmacistIds = initialPharmacistIds.filter(
        id => !selectedPharmacistIds.includes(id)
      );
      
      // Pass both selected and removed pharmacists
      onSelectMultiple(selectedPharmacistIds, selectedScope, removedPharmacistIds);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">{allowMultipleSelection ? "Select Pharmacists" : "Select Pharmacist"}</h2>
            <p className="text-sm text-gray-600 mt-1">For: {location}</p>
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
            placeholder="Search pharmacists..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setSelectedScope("slot")}
            className={`px-3 py-1 rounded-lg ${selectedScope === "slot" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            Single Slot
          </button>
          <button
            onClick={() => setSelectedScope("day")}
            className={`px-3 py-1 rounded-lg ${selectedScope === "day" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            Full Day
          </button>
          <button
            onClick={() => setSelectedScope("week")}
            className={`px-3 py-1 rounded-lg ${selectedScope === "week" ? "bg-blue-500 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
          >
            Full Week
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2">
            {filteredPharmacists.map((pharmacist) => (
              <div
                key={pharmacist._id}
                className={`w-full text-left p-3 rounded-lg hover:bg-gray-100 ${(
                  allowMultipleSelection 
                    ? selectedPharmacistIds.includes(pharmacist._id)
                    : currentPharmacistId === pharmacist._id
                ) ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {allowMultipleSelection ? (
                    <input
                      type="checkbox"
                      checked={selectedPharmacistIds.includes(pharmacist._id)}
                      onChange={() => handleSelect(pharmacist._id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  ) : null}
                  <div className="flex-grow">
                    <div className="font-medium">{pharmacist.name}</div>
                    <div className="text-sm text-gray-500">
                      Band {pharmacist.band} • {pharmacist.primaryDirectorate || 'No default directorate'}
                    </div>
                  </div>
                  {!allowMultipleSelection && (
                    <button
                      onClick={() => handleSelect(pharmacist._id)}
                      className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                    >
                      Select
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Add a confirm button for multiple selection */}
        {allowMultipleSelection && (
          <div className="mt-4 flex justify-end">
            <p className="text-center text-sm font-medium mb-2">
              {selectedPharmacistIds.length} pharmacist{selectedPharmacistIds.length !== 1 ? "s" : ""} selected
            </p>
            <button
              className={`mt-4 px-4 py-2 rounded-lg w-full font-medium text-white bg-blue-500 hover:bg-blue-600`}
              onClick={handleConfirmMultipleSelection}
            >
              {selectedPharmacistIds.length > 0 ? "Confirm Selection" : "Clear All Pharmacists"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
