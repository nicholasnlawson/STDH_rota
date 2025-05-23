import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id, Doc } from "../convex/_generated/dataModel";

interface TechnicianListProps {
  isAdmin: boolean;
  userEmail: string;
}

export function TechnicianList({ isAdmin, userEmail }: TechnicianListProps) {
  const technicians = useQuery(api.technicians.list) || [];
  const addTechnician = useMutation(api.technicians.add);
  const removeTechnician = useMutation(api.technicians.remove);
  const updateTechnician = useMutation(api.technicians.update);
  const wardsQuery = useQuery(api.requirements.listWards) || [];

  // Get a list of all wards
  const allWards = wardsQuery.map((ward: { name: string }) => ward.name);

  // Explicitly type formData and editFormData
  type NotAvailableRule = {
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  };
  
  type TechnicianFormData = {
    name: string; // Full name
    displayName: string; // "Appears in rota as"
    email: string; // Required for authentication
    band: string; // Band 4, 5, or 6
    primaryWards: string[]; // Primary wards assigned
    isAccuracyChecker: boolean; // Whether technician is an accuracy checker
    isMedsRecTrained: boolean; // Whether technician is medication reconciliation trained
    isWarfarinTrained: boolean; // Whether technician is warfarin trained
    isDefaultTechnician: boolean; // Whether this is the default technician
    isAdmin: boolean; // Whether this user has admin privileges
    preferences: string[];
    availability: string[];
    workingDays: string[]; // Usual working days (e.g., ["Monday", "Tuesday"])
    specialistTraining: string[];
    notAvailableRules?: NotAvailableRule[];
  };

  const [formData, setFormData] = useState<TechnicianFormData>({
    name: "",
    displayName: "",
    email: "",
    band: "5", // Default to band 5
    primaryWards: [],
    isAccuracyChecker: false,
    isMedsRecTrained: false,
    isWarfarinTrained: false,
    isDefaultTechnician: false,
    isAdmin: false,
    specialistTraining: [],
    preferences: [],
    availability: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    workingDays: [],
    notAvailableRules: [],
  });

  const [editingId, setEditingId] = useState<Id<"technicians"> | null>(null);
  const [editFormData, setEditFormData] = useState<TechnicianFormData | null>(null);
  
  // State for the all technicians modal
  const [showAllTechniciansModal, setShowAllTechniciansModal] = useState(false);
  // Track if we're editing inside the modal
  const [editingInModal, setEditingInModal] = useState(false);
  
  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  // Get current user's technician data
  const currentUser = technicians.find(t => t.email === userEmail);
  // Type assertion for the technicians array
  const technicianDocs = technicians as TechnicianDoc[];
  
  const filteredTechnicians = (isAdmin 
    ? [...technicianDocs].sort((a, b) => a.name.localeCompare(b.name))
    : technicianDocs.filter(tech => tech.email === userEmail)
  ).filter(tech => tech.name.toLowerCase().includes(searchTerm.toLowerCase()));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await addTechnician(formData);
    setFormData({
      name: "",
      displayName: "",
      email: "",
      band: "5",
      primaryWards: [],
      isAccuracyChecker: false,
      isMedsRecTrained: false,
      isWarfarinTrained: false,
      isAdmin: false,
      isDefaultTechnician: false,
      specialistTraining: [],
      preferences: [],
      availability: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      workingDays: [],
      notAvailableRules: [],
    });
  }

  // Extend the base technician document type to include isDefaultTechnician
  interface TechnicianDoc extends Doc<"technicians"> {
    isDefaultTechnician?: boolean;
  }

  function handleEditClick(technician: TechnicianDoc) {
    setEditingId(technician._id);
    setEditFormData({
      name: technician.name,
      displayName: technician.displayName || "",
      band: technician.band,
      primaryWards: technician.primaryWards || [],
      isAccuracyChecker: technician.isAccuracyChecker,
      isMedsRecTrained: technician.isMedsRecTrained,
      isWarfarinTrained: Boolean(technician.isWarfarinTrained),
      isDefaultTechnician: technician.isDefaultTechnician || false,
      isAdmin: Boolean(technician.isAdmin),
      workingDays: technician.workingDays || [],
      notAvailableRules: technician.notAvailableRules || [],
      specialistTraining: technician.specialistTraining || [],
      preferences: technician.preferences || [],
      availability: technician.availability || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      email: technician.email,
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId && editFormData) {
      // If name is set but displayName is empty, use name as displayName
      if (!editFormData.displayName && editFormData.name) {
        editFormData.displayName = editFormData.name;
      }
      // If displayName is set but name is empty, use displayName as name
      if (!editFormData.name && editFormData.displayName) {
        editFormData.name = editFormData.displayName;
      }
      
      // Remove Convex system fields before sending to updateTechnician (runtime only)
      const { _id, _creationTime, ...rest } = (editFormData as any);
      const safeEditFormData: TechnicianFormData = {
        ...rest,
        preferences: rest.preferences || [],
        availability: rest.availability || [],
        primaryWards: rest.primaryWards || [],
        workingDays: rest.workingDays || [],
        notAvailableRules: rest.notAvailableRules || [],
        specialistTraining: rest.specialistTraining || [],
      };
      await updateTechnician({ id: editingId, ...safeEditFormData });
      setEditingId(null);
      setEditFormData(null);
    }
  }

  function handleEditCancel() {
    setEditingId(null);
    setEditFormData(null);
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-semibold mb-4">Pharmacy Technicians</h2>

      {/* Add Technician Form - Only show for admins */}
      {isAdmin && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold mb-4">Add New Technician</h2>

          {/* Quick Add Form */}
          <form onSubmit={handleSubmit} className="space-y-4 mb-8">
            <h3 className="text-lg font-medium mb-4">Add New Technician</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Display Name (appears in rota)
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="Optional"
                  className="w-full rounded border-gray-300"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Band
                </label>
                <select
                  value={formData.band}
                  onChange={e => setFormData({ ...formData, band: e.target.value })}
                  className="w-full rounded border-gray-300"
                >
                  <option value="4">Band 4</option>
                  <option value="5">Band 5</option>
                  <option value="6">Band 6</option>
                </select>
              </div>
            </div>
            
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Primary Ward(s)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {allWards.map((ward: string) => (
                  <label key={ward} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.primaryWards.includes(ward)}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          primaryWards: isChecked
                            ? [...prev.primaryWards, ward]
                            : prev.primaryWards.filter(w => w !== ward)
                        }));
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{ward}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isAccuracyChecker}
                    onChange={e => setFormData({ ...formData, isAccuracyChecker: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Accuracy Checker</span>
                </label>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isWarfarinTrained}
                    onChange={e => setFormData({ ...formData, isWarfarinTrained: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Warfarin Trained</span>
                </label>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isMedsRecTrained}
                    onChange={e => setFormData({ ...formData, isMedsRecTrained: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Meds Rec Trained</span>
                </label>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isDefaultTechnician}
                    onChange={e => setFormData({ ...formData, isDefaultTechnician: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Default Technician</span>
                </label>
              </div>
              {isAdmin && (
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.isAdmin || false}
                      onChange={e => setFormData({ ...formData, isAdmin: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium">Admin User</span>
                  </label>
                </div>
              )}
            </div>
            
            {/* Working Days */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Usual Working Days</label>
              <div className="flex flex-wrap gap-2">
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const newWorkingDays = formData.workingDays.includes(day)
                        ? formData.workingDays.filter(d => d !== day)
                        : [...formData.workingDays, day];
                      setFormData({ ...formData, workingDays: newWorkingDays });
                    }}
                    className={`px-3 py-1 rounded-full text-sm ${
                      formData.workingDays.includes(day)
                        ? 'bg-blue-100 text-blue-800 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 border border-gray-300'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
            
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors duration-200"
            >
              Add Technician
            </button>
          </form>
        </div>
      )}

      {/* Search Technicians */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-medium">Technicians</h3>
          <button
            onClick={() => setShowAllTechniciansModal(true)}
            className="text-blue-600 hover:text-blue-700"
          >
            View All
          </button>
        </div>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              placeholder="Search technicians..."
              className="border rounded px-2 py-1 w-64"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                className="text-gray-600 hover:text-gray-900"
                onClick={() => setSearchTerm('')}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Technicians List */}
      <div className="space-y-3 mt-2">
        {filteredTechnicians.map((technician: TechnicianDoc) => (
          <div key={technician._id} className="p-3 bg-white shadow-sm border border-gray-200 rounded-md flex justify-between items-center hover:shadow-md transition-shadow duration-200">
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-medium">{technician.name}</span>
                {technician.isAdmin && (
                  <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs border border-yellow-200">
                    Admin
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-500">
                Band {technician.band} • {technician.primaryWards?.join(", ") || "No primary wards"}
              </div>
              <div className="text-xs text-gray-500 flex space-x-2 mt-1">
                {technician.isAccuracyChecker && (
                  <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">Accuracy Checker</span>
                )}
                {technician.isMedsRecTrained && (
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">Meds Rec Trained</span>
                )}
                {technician.isWarfarinTrained && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Warfarin</span>
                )}
              </div>
            </div>
            {(isAdmin || technician.email === userEmail) && (
              <div className="flex space-x-2">
                <button
                  onClick={() => handleEditClick(technician)}
                  className="text-blue-600 hover:text-blue-800"
                  disabled={!isAdmin && technician.email !== userEmail}
                >
                  {isAdmin ? 'Edit' : 'View Details'}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => removeTechnician({ id: technician._id })}
                    className="text-red-600 hover:text-red-800"
                    disabled={technician.isDefaultTechnician}
                    title={technician.isDefaultTechnician ? 'Cannot delete default technician' : ''}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {filteredTechnicians.length === 0 && (
          <div className="p-4 text-center text-gray-500">
            No technicians found matching '{searchTerm}'
          </div>
        )}
      </div>

      {/* Edit Modal - Only show if user is admin or viewing their own profile */}
      {editingId && editFormData && (isAdmin || editFormData.email === userEmail) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Edit Technician</h3>
              <button
                onClick={handleEditCancel}
                className="text-gray-500 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                    required
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Name (appears in rota)
                  </label>
                  <input
                    type="text"
                    value={editFormData.displayName}
                    onChange={e => setEditFormData({ ...editFormData, displayName: e.target.value })}
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editFormData.email}
                    onChange={e => setEditFormData({ ...editFormData, email: e.target.value })}
                    required
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Band
                  </label>
                  <select
                    value={editFormData.band}
                    onChange={e => setEditFormData({ ...editFormData, band: e.target.value })}
                    className="w-full p-2 border border-gray-300 rounded"
                  >
                    <option value="4">Band 4</option>
                    <option value="5">Band 5</option>
                    <option value="6">Band 6</option>
                  </select>
                </div>
              </div>
              
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Ward(s)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {allWards.map((ward: string) => (
                    <label key={ward} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={editFormData.primaryWards.includes(ward)}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setEditFormData(prev => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              primaryWards: isChecked
                                ? [...(prev.primaryWards || []), ward]
                                : (prev.primaryWards || []).filter(w => w !== ward)
                            };
                          });
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{ward}</span>
                    </label>
                  ))}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={editFormData.isAccuracyChecker}
                      onChange={e => setEditFormData({ ...editFormData, isAccuracyChecker: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium">Accuracy Checker</span>
                  </label>
                </div>
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={editFormData.isMedsRecTrained}
                      onChange={e => setEditFormData({ ...editFormData, isMedsRecTrained: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium">Meds Rec Trained</span>
                  </label>
                </div>
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={editFormData.isWarfarinTrained}
                      onChange={e => setEditFormData({ ...editFormData, isWarfarinTrained: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium">Warfarin Trained</span>
                  </label>
                </div>
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={!!editFormData.isDefaultTechnician}
                      onChange={e => setEditFormData(prev => prev ? { ...prev, isDefaultTechnician: e.target.checked } : null)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium">Default Technician</span>
                  </label>
                </div>
                {isAdmin && (
                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={editFormData.isAdmin || false}
                        onChange={e => setEditFormData(prev => prev ? { ...prev, isAdmin: e.target.checked } : null)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm font-medium">Admin User</span>
                    </label>
                  </div>
                )}
              </div>
              
              {/* Working Days */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Usual Working Days</label>
                <div className="flex flex-wrap gap-2">
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const currentWorkingDays = editFormData.workingDays || [];
                        const newWorkingDays = currentWorkingDays.includes(day)
                          ? currentWorkingDays.filter(d => d !== day)
                          : [...currentWorkingDays, day];
                        setEditFormData(prev => prev ? { ...prev, workingDays: newWorkingDays } : null);
                      }}
                      className={`px-3 py-1 rounded-full text-sm ${
                        (editFormData.workingDays || []).includes(day)
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : 'bg-gray-100 text-gray-600 border border-gray-300'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-white rounded ${
                    isAdmin 
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gray-400 cursor-not-allowed'
                  }`}
                  disabled={!isAdmin}
                  title={!isAdmin ? 'Only administrators can make changes' : ''}
                >
                  {isAdmin ? 'Save Changes' : 'View Mode'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View All Technicians Modal */}
      {showAllTechniciansModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-xl font-semibold">All Technicians</h3>
              <button
                onClick={() => {
                  setShowAllTechniciansModal(false);
                  setEditingInModal(false);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            
            <div className="p-4">
              <input
                type="text"
                placeholder="Search technicians..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded mb-4"
              />
              
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Band</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Primary Ward(s)</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skills</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredTechnicians.map((technician: Doc<"technicians">) => (
                    <tr key={technician._id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{technician.name}</div>
                        <div className="text-sm text-gray-500">{technician.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">Band {technician.band}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {technician.primaryWards?.join(", ") || "None assigned"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {technician.isAccuracyChecker && (
                            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">Accuracy Checker</span>
                          )}
                          {technician.isMedsRecTrained && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">Meds Rec Trained</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => {
                            handleEditClick(technician);
                            setEditingInModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm("Are you sure you want to remove this technician?")) {
                              removeTechnician({ id: technician._id });
                            }
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {filteredTechnicians.length === 0 && (
                <div className="py-8 text-center text-gray-500">
                  No technicians found matching '{searchTerm}'
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
