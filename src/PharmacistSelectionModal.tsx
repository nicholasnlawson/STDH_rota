import { Id } from "../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

interface PharmacistSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pharmacistId: Id<"pharmacists">, scope: "slot" | "day" | "week") => void;
  currentPharmacistId: Id<"pharmacists"> | null;
  location: string;
}

export function PharmacistSelectionModal({ isOpen, onClose, onSelect, currentPharmacistId, location }: PharmacistSelectionModalProps) {
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedScope, setSelectedScope] = useState<"slot" | "day" | "week">("slot");

  if (!isOpen) return null;

  const filteredPharmacists = pharmacists.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (pharmacistId: Id<"pharmacists">) => {
    onSelect(pharmacistId, selectedScope);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Select Pharmacist</h2>
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
              <button
                key={pharmacist._id}
                onClick={() => handleSelect(pharmacist._id)}
                className={`w-full text-left p-3 rounded-lg hover:bg-gray-100 ${currentPharmacistId === pharmacist._id ? 'bg-blue-50 ring-2 ring-blue-500' : ''}`}
              >
                <div className="font-medium">{pharmacist.name}</div>
                <div className="text-sm text-gray-500">
                  Band {pharmacist.band} • {pharmacist.primaryDirectorate || 'No default directorate'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
