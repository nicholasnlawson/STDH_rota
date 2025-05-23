import { Id } from "../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

interface TechnicianSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTechnicians: (technicianIds: Id<"technicians">[]) => void;
  selectedTechnicianIds: Id<"technicians">[];
}

export function TechnicianSelectionModal({ 
  isOpen, 
  onClose, 
  onSelectTechnicians, 
  selectedTechnicianIds 
}: TechnicianSelectionModalProps) {
  const technicians = useQuery(api.technicians.list) || [];
  const [searchTerm, setSearchTerm] = useState("");
  const [localSelectedTechnicianIds, setLocalSelectedTechnicianIds] = useState<Id<"technicians">[]>(selectedTechnicianIds);

  if (!isOpen) return null;

  // Filter technicians based on search term, then sort alphabetically by name
  const filteredTechnicians = technicians
    .filter(t => 
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (t.displayName && t.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      // Use displayName if available, otherwise fall back to name
      const nameA = (a.displayName || a.name).toLowerCase();
      const nameB = (b.displayName || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const handleToggleTechnician = (technicianId: Id<"technicians">) => {
    setLocalSelectedTechnicianIds(prev => {
      if (prev.includes(technicianId)) {
        return prev.filter(id => id !== technicianId);
      } else {
        return [...prev, technicianId];
      }
    });
  };

  const handleSelectAll = () => {
    setLocalSelectedTechnicianIds(technicians.map(t => t._id));
  };

  const handleDeselectAll = () => {
    setLocalSelectedTechnicianIds([]);
  };

  const handleDefaultTechnicians = () => {
    setLocalSelectedTechnicianIds(
      technicians.filter(t => t.isDefaultTechnician).map(t => t._id)
    );
  };

  const handleSave = () => {
    onSelectTechnicians(localSelectedTechnicianIds);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Select Technicians</h2>
            <p className="text-sm text-gray-600 mt-1">
              {localSelectedTechnicianIds.length} technicians selected
            </p>
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
            onClick={handleSelectAll}
            className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200"
          >
            Select All
          </button>
          <button
            onClick={handleDeselectAll}
            className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200"
          >
            Deselect All
          </button>
          <button
            onClick={handleDefaultTechnicians}
            className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200"
          >
            Default Only
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mb-4">
          <div className="space-y-2">
            {filteredTechnicians.map((technician) => (
              <div
                key={technician._id}
                className={`w-full text-left p-3 rounded-lg hover:bg-gray-100 cursor-pointer flex items-center
                  ${localSelectedTechnicianIds.includes(technician._id) ? 'bg-blue-50 ring-1 ring-blue-500' : ''}`}
                onClick={() => handleToggleTechnician(technician._id)}
              >
                <input
                  type="checkbox"
                  checked={localSelectedTechnicianIds.includes(technician._id)}
                  onChange={() => handleToggleTechnician(technician._id)}
                  className="mr-3 h-5 w-5 text-blue-600"
                  onClick={(e) => e.stopPropagation()}
                />
                <div>
                  <div className="font-medium">{technician.displayName || technician.name}</div>
                  <div className="text-sm text-gray-500">
                    {technician.primaryWards && technician.primaryWards.length > 0 ? 
                      `${technician.primaryWards.join(', ')} (Primary)` : 'No primary ward'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
          >
            Save Selection
          </button>
        </div>
      </div>
    </div>
  );
}
