import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
// Use browser's built-in alert instead of toast since react-toastify isn't available

// Categories for organizing technician requirements
const CATEGORIES = [
  { id: "pharmacy_dispensary", name: "Pharmacy & Dispensary" },
  { id: "ward", name: "Ward" },
];

export function TechnicianRequirementsList() {
  const requirements = useQuery(api.technicianRequirements.listRequirements) || [];
  const trainingTypes = useQuery(api.technicianRequirements.listTrainingTypes) || [];
  const clinics = useQuery(api.clinics.listClinics) || [];
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  
  const initializeSystemSettings = useMutation(api.technicianRequirements.initializeSystemSettings);
  const addRequirement = useMutation(api.technicianRequirements.addRequirement);
  const updateRequirement = useMutation(api.technicianRequirements.updateRequirement);
  const deleteRequirement = useMutation(api.technicianRequirements.deleteRequirement);
  const deleteCategory = useMutation(api.technicianRequirements.deleteCategory);
  const addTrainingType = useMutation(api.technicianRequirements.addTrainingType);
  const deleteTrainingType = useMutation(api.technicianRequirements.deleteTrainingType);
  const updateTrainingType = useMutation(api.technicianRequirements.updateTrainingType);
  const updateClinic = useMutation(api.clinics.updateClinic);
  const addClinic = useMutation(api.clinics.addClinic);
  
  // Import functionality
  const [showImportOptions, setShowImportOptions] = useState(false);
  
  const [showForm, setShowForm] = useState(false);
  const [showClinicForm, setShowClinicForm] = useState(false);
  const [selectedClinic, setSelectedClinic] = useState<any>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<typeof requirements[0] | null>(null);
  const [requiresSpecialTraining, setRequiresSpecialTraining] = useState(false);
  const [trainingType, setTrainingType] = useState("");
  const [category, setCategory] = useState("Pharmacy & Dispensary");
  
  // Filter warfarin clinics
  const warfarinClinics = useMemo(() => 
    clinics.filter(clinic => 
      clinic.requiresWarfarinTraining === true && clinic.isActive
    ).sort((a, b) => {
      // Sort by day then by start time
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startTime.localeCompare(b.startTime);
    }), 
    [clinics]
  );
  
  // Group requirements by category
  const requirementsByCategory = useMemo(() => {
    const grouped: Record<string, typeof requirements> = {};
    
    // Initialize with all categories
    CATEGORIES.forEach(cat => {
      grouped[cat.name] = [];
    });
    
    // Add requirements to their categories
    requirements.forEach(req => {
      if (!grouped[req.category]) {
        grouped[req.category] = [];
      }
      grouped[req.category].push(req);
    });
    
    // Sort requirements within each category
    Object.values(grouped).forEach(reqs => {
      reqs.sort((a, b) => a.name.localeCompare(b.name));
    });
    
    return grouped;
  }, [requirements]);
  
  // Extract category names for easy use
  const categoryNames = useMemo(() => 
    CATEGORIES.map(cat => cat.name), []
  );
  

  
  // Get all wards from directorates for import functionality
  const allWards = useMemo(() => {
    return directorates.flatMap(dir => 
      dir.wards.map(ward => ({
        directorateName: dir.name,
        ...ward
      }))
    ).filter(ward => ward.isActive);
  }, [directorates]);
  
  // Get all unique categories from existing requirements
  const allCategories = useMemo(() => {
    const cats = new Set(requirements.map(req => req.category));
    return Array.from(cats).sort();
  }, [requirements]);
  
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold">Technician Rota Requirements</h2>
        
        {requirements.length === 0 && (
          <button
            className="bg-green-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-600"
            onClick={() => initializeSystemSettings({})}
          >
            Initialize System Settings
          </button>
        )}
      </div>
      
      {/* Requirements Table */}
      {categoryNames.map(categoryName => (
        <div key={categoryName} className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-xl font-medium">{categoryName}</h3>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (window.confirm(`Are you sure you want to delete the category '${categoryName}' and all its requirements? This action cannot be undone.`)) {
                  try {
                    const result = await deleteCategory({ category: categoryName });
                    alert(result.message);
                  } catch (error) {
                    console.error('Error deleting category:', error);
                    alert('Failed to delete category. Please try again.');
                  }
                }
              }}
              className="text-red-500 hover:text-red-700 text-sm font-medium"
              title={`Delete ${categoryName} category`}
            >
              Delete Category
            </button>
          </div>
          <table className="min-w-full mb-4 border text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-3 text-left">Assignment</th>
                <th className="py-2 px-3 text-left">Min</th>
                <th className="py-2 px-3 text-left">Ideal</th>
                <th className="py-2 px-3 text-left">Weighting</th>
                <th className="py-2 px-3 text-left">Special Training</th>
                <th className="py-2 px-3 text-left">Active</th>
                <th className="py-2 px-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requirementsByCategory[categoryName]?.map((req) => (
                <tr key={req._id} className="border-t hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium">{req.name}</td>
                  <td className="py-2 px-3">{req.minTechnicians}</td>
                  <td className="py-2 px-3">{req.idealTechnicians}</td>
                  <td className="py-2 px-3">{req.difficulty}/10</td>
                  <td className="py-2 px-3 text-xs text-gray-600">
                    {req.requiresSpecialTraining ? (req.trainingType || "Yes") : "No"}
                  </td>
                  <td className="py-2 px-3">
                    {req.isActive ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-gray-400">Inactive</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                      <button
                        className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 mr-2"
                        onClick={() => {
                          setSelectedRequirement(req);
                          setRequiresSpecialTraining(req.requiresSpecialTraining);
                          setTrainingType(req.trainingType || "");
                          setCategory(req.category);
                          setShowForm(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-600"
                        onClick={async () => {
                          if (window.confirm(`Delete requirement '${req.name}'?`)) {
                            try {
                              await deleteRequirement({ id: req._id as Id<"technicianRequirements"> });
                              alert("Requirement deleted successfully");
                            } catch (error) {
                              console.error("Error deleting requirement:", error);
                              alert("Failed to delete requirement");
                            }
                          }
                        }}
                      >
                        Delete
                      </button>
                  </td>
                </tr>
              ))}
              {requirementsByCategory[categoryName]?.length === 0 && (
                <tr className="border-t">
                  <td colSpan={7} className="py-4 text-center text-gray-500">
                    No requirements in this category
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      
      <div className="mb-8 flex gap-3">
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded text-base font-medium hover:bg-blue-600"
          onClick={() => {
            setSelectedRequirement(null);
            setRequiresSpecialTraining(false);
            setTrainingType("");
            setCategory("Pharmacy & Dispensary");
            setShowForm(true);
          }}
        >
          Add New Requirement
        </button>
      </div>
      
      {/* Clinics Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Clinics</h2>
        <table className="min-w-full mb-8 border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="py-2 px-3 text-left">Clinic</th>
              <th className="py-2 px-3 text-left">Day</th>
              <th className="py-2 px-3 text-left">Time</th>
              <th className="py-2 px-3 text-left">Coverage Note</th>
              <th className="py-2 px-3 text-left">Status</th>
              <th className="py-2 px-3 text-left">Edit</th>
            </tr>
          </thead>
          <tbody>
            {warfarinClinics.map(clinic => (
              <tr key={clinic._id} className="border-t hover:bg-gray-50">
                <td className="py-2 px-3 font-medium">{clinic.name}</td>
                <td className="py-2 px-3">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][clinic.dayOfWeek - 1]}</td>
                <td className="py-2 px-3">{clinic.startTime} - {clinic.endTime}</td>
                <td className="py-2 px-3 text-xs text-gray-600">{clinic.coverageNote || ""}</td>
                <td className="py-2 px-3">
                  {clinic.isActive ? (
                    <span className="text-green-600">Active</span>
                  ) : (
                    <span className="text-gray-400">Inactive</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <button
                    className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                    onClick={() => {
                      setShowClinicForm(true);
                      setSelectedClinic(clinic);
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {warfarinClinics.length === 0 && (
              <tr className="border-t">
                <td colSpan={6} className="py-4 text-center text-gray-500">
                  No clinics found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <button
          className="bg-blue-600 text-white px-3 py-2 rounded mb-4 hover:bg-blue-700"
          onClick={() => {
            setSelectedClinic(null);
            setShowClinicForm(true);
          }}
        >
          Add Clinic
        </button>
      </div>

      {/* Training Types Section */}
      <div className="mb-8">
        <h3 className="text-xl font-medium mb-3">Special Training Types</h3>
        <div className="flex gap-2 flex-wrap mb-4">
          {trainingTypes.map((type) => (
            <span key={type._id} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center gap-1">
              <span
                className="cursor-pointer hover:underline"
                onClick={async () => {
                  const newName = window.prompt(`Edit training type:`, type.name);
                  if (newName && newName.trim() && newName !== type.name) {
                    await updateTrainingType({
                      id: type._id as Id<"technicianTrainingTypes">,
                      name: newName.trim(),
                    });
                  }
                }}
                title="Click to edit"
              >
                {type.name}
              </span>
              <button
                className="ml-1 text-red-500 hover:text-red-700 font-bold text-xs"
                title="Delete type"
                onClick={async () => {
                  if (window.confirm(`Delete training type '${type.name}'?`)) {
                    await deleteTrainingType({ id: type._id as Id<"technicianTrainingTypes"> });
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form 
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const newTypeName = form.newTrainingType.value.trim();
            if (newTypeName) {
              await addTrainingType({ name: newTypeName });
              form.reset();
            }
          }} 
          className="flex gap-2 mb-4"
        >
          <input 
            name="newTrainingType" 
            className="border rounded px-2 py-1 text-sm" 
            placeholder="Add new training type" 
          />
          <button type="submit" className="bg-blue-500 text-white px-2 py-1 rounded text-xs">
            Add
          </button>
        </form>
      </div>
      
      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">
                {selectedRequirement ? "Edit Requirement" : "Add New Requirement"}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold absolute top-2 right-4"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const formData = new FormData(form);
                
                const requirementData = {
                  name: formData.get("name") as string,
                  minTechnicians: parseFloat(formData.get("minTechnicians") as string),
                  idealTechnicians: parseFloat(formData.get("idealTechnicians") as string),
                  difficulty: parseInt(formData.get("difficulty") as string),
                  isActive: formData.get("isActive") === "on",
                  includeByDefaultInRota: formData.get("includeByDefaultInRota") === "on",
                  requiresSpecialTraining,
                  trainingType: requiresSpecialTraining ? trainingType : undefined,
                  category: formData.get("category") as string,
                };
                
                if (selectedRequirement) {
                  await updateRequirement({
                    id: selectedRequirement._id as Id<"technicianRequirements">,
                    ...requirementData,
                  });
                } else {
                  await addRequirement(requirementData);
                }
                
                setShowForm(false);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700">Assignment Name</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={selectedRequirement?.name || ""}
                  required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="Ward">Ward</option>
                  <option value="Pharmacy & Dispensary">Pharmacy & Dispensary</option>
                  <option value="new">+ Add New Category</option>
                </select>
              </div>
              {category === "new" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">New Category Name</label>
                  <input
                    type="text"
                    name="newCategory"
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    onChange={(e) => {
                      if (e.target.value) {
                        setCategory(e.target.value);
                      }
                    }}
                  />
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Minimum Technicians</label>
                  <input
                    type="number"
                    name="minTechnicians"
                    defaultValue={selectedRequirement?.minTechnicians || 1}
                    required
                    min="0"
                    step="0.5"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Ideal Technicians</label>
                  <input
                    type="number"
                    name="idealTechnicians"
                    defaultValue={selectedRequirement?.idealTechnicians || 1}
                    required
                    min="0"
                    step="0.5"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Weighting (1-10)</label>
                <input
                  type="number"
                  name="difficulty"
                  defaultValue={selectedRequirement?.difficulty || 5}
                  required
                  min="1"
                  max="10"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              
              <div className="flex gap-4 mb-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={selectedRequirement?.isActive ?? true}
                  />
                  <span className="ml-2">Active</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="includeByDefaultInRota"
                    defaultChecked={selectedRequirement?.includeByDefaultInRota ?? false}
                  />
                  <span className="ml-2">Include by Default in Rota</span>
                </label>
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={requiresSpecialTraining}
                    onChange={(e) => setRequiresSpecialTraining(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="ml-2 text-sm">Requires Special Training</span>
                </label>
              </div>
              
              {requiresSpecialTraining && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Training Type</label>
                  <select
                    value={trainingType}
                    onChange={(e) => setTrainingType(e.target.value)}
                    required={requiresSpecialTraining}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">Select Training Type</option>
                    {trainingTypes.map((type) => (
                      <option key={type._id} value={type.name}>{type.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 text-white px-4 py-2 rounded font-medium hover:bg-blue-600"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Clinic Form */}
      {showClinicForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">{selectedClinic ? "Edit Clinic" : "Add Clinic"}</h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold absolute top-2 right-4"
                onClick={() => {
                  setShowClinicForm(false);
                  setSelectedClinic(null);
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            {selectedClinic ? (
              // Edit existing clinic form
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    // Update existing clinic
                    await updateClinic({
                      clinicId: selectedClinic._id as Id<"clinics">,
                      name: selectedClinic.name,
                      dayOfWeek: selectedClinic.dayOfWeek,
                      startTime: selectedClinic.startTime,
                      endTime: selectedClinic.endTime,
                      requiresWarfarinTraining: selectedClinic.requiresWarfarinTraining,
                      travelTimeBefore: selectedClinic.travelTimeBefore,
                      travelTimeAfter: selectedClinic.travelTimeAfter,
                      isRegular: selectedClinic.isRegular,
                      isActive: selectedClinic.isActive,
                      includeByDefaultInRota: selectedClinic.includeByDefaultInRota,
                      coverageNote: selectedClinic.coverageNote,
                      preferredPharmacists: selectedClinic.preferredPharmacists || [],
                    });
                    alert("Clinic updated successfully");
                    setShowClinicForm(false);
                    setSelectedClinic(null);
                  } catch (error) {
                    console.error("Error updating clinic:", error);
                    alert("Failed to update clinic");
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700">Clinic Name</label>
                  <input
                    type="text"
                    value={selectedClinic.name}
                    disabled
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Day</label>
                    <input
                      type="text"
                      value={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][selectedClinic.dayOfWeek - 1]}
                      disabled
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Time</label>
                    <input
                      type="text"
                      value={`${selectedClinic.startTime} - ${selectedClinic.endTime}`}
                      disabled
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Coverage Note</label>
                  <input
                    type="text"
                    value={selectedClinic.coverageNote || ""}
                    onChange={(e) => setSelectedClinic({...selectedClinic, coverageNote: e.target.value})}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                
                <div className="flex items-center gap-4">
                  <label className="flex items-center text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selectedClinic.isActive}
                      onChange={(e) => setSelectedClinic({...selectedClinic, isActive: e.target.checked})}
                    />
                    <span className="ml-2">Active</span>
                  </label>
                  <label className="flex items-center text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selectedClinic.includeByDefaultInRota}
                      onChange={(e) => setSelectedClinic({...selectedClinic, includeByDefaultInRota: e.target.checked})}
                    />
                    <span className="ml-2">Include by Default in Rota</span>
                  </label>
                </div>
                
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300"
                    onClick={() => {
                      setShowClinicForm(false);
                      setSelectedClinic(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-500 text-white px-4 py-2 rounded font-medium hover:bg-blue-600"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              // Add new clinic form
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const form = e.target as HTMLFormElement;
                    const formData = new FormData(form);
                    
                    // Add new clinic with simplified fields
                    await addClinic({
                      name: formData.get("name") as string,
                      dayOfWeek: parseInt(formData.get("dayOfWeek") as string),
                      startTime: formData.get("startTime") as string,
                      endTime: formData.get("endTime") as string,
                      requiresWarfarinTraining: true, // Always true for technician clinics
                      travelTimeBefore: 30, // Default value
                      travelTimeAfter: 30, // Default value
                      isRegular: false, // Default value
                      isActive: formData.get("isActive") === "on",
                      includeByDefaultInRota: formData.get("includeByDefaultInRota") === "on",
                      coverageNote: formData.get("coverageNote") as string || undefined,
                    });
                    alert("Clinic added successfully");
                    setShowClinicForm(false);
                  } catch (error) {
                    console.error("Error adding clinic:", error);
                    alert("Failed to add clinic");
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Day</label>
                  <select
                    name="dayOfWeek"
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Start Time</label>
                  <input
                    type="time"
                    name="startTime"
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">End Time</label>
                  <input
                    type="time"
                    name="endTime"
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Coverage Note</label>
                  <input
                    type="text"
                    name="coverageNote"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                
                <div className="flex flex-col space-y-2">
                  <label className="flex items-center text-sm font-medium">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked
                    />
                    <span className="ml-2">Active</span>
                  </label>
                  <label className="flex items-center text-sm font-medium">
                    <input
                      type="checkbox"
                      name="includeByDefaultInRota"
                    />
                    <span className="ml-2">Include by Default in Rota</span>
                  </label>
                </div>
                
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300"
                    onClick={() => {
                      setShowClinicForm(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-500 text-white px-4 py-2 rounded font-medium hover:bg-blue-600"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6 relative">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Import Requirements</h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold absolute top-2 right-4"
                onClick={() => setShowImportOptions(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            <div className="mb-6">
              <p className="text-gray-600 mb-4">
                You can import ward assignments and clinic assignments from the pharmacist section to create equivalent technician requirements.
              </p>
              
              <div className="space-y-4">
                {/* Import Ward Requirements Section */}
                <div className="border p-4 rounded-md bg-gray-50">
                  <h4 className="font-medium text-lg mb-2">Import Ward Requirements</h4>
                  <p className="text-sm text-gray-500 mb-3">
                    Import ward requirements from the pharmacist section to create matching technician ward requirements.
                  </p>
                  
                  <div className="max-h-60 overflow-y-auto mb-3 border rounded">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="py-2 px-3 text-left">Select</th>
                          <th className="py-2 px-3 text-left">Directorate</th>
                          <th className="py-2 px-3 text-left">Ward</th>
                          <th className="py-2 px-3 text-left">Weighting</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allWards.map((ward, idx) => (
                          <tr key={`${ward.directorateName}-${ward.name}`} className="border-t hover:bg-gray-50">
                            <td className="py-2 px-3">
                              <input 
                                type="checkbox" 
                                name={`ward-${idx}`}
                                id={`ward-${idx}`}
                                value={JSON.stringify({ directorateName: ward.directorateName, wardName: ward.name })}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="py-2 px-3">{ward.directorateName}</td>
                            <td className="py-2 px-3 font-medium">{ward.name}</td>
                            <td className="py-2 px-3">{ward.difficulty}/10</td>
                          </tr>
                        ))}
                        {allWards.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-gray-500">
                              No ward requirements found to import.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  <button 
                    type="button" 
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
                    disabled={allWards.length === 0}
                    onClick={async () => {
                      const checkboxes = document.querySelectorAll('input[name^="ward-"]:checked');
                      if (checkboxes.length === 0) {
                        alert("Please select at least one ward to import");
                        return;
                      }
                      
                      try {
                        // Convert to array and process selected wards
                        const selectedWards = Array.from(checkboxes).map((cb: any) => JSON.parse(cb.value));
                        
                        for (const item of selectedWards) {
                          const ward = allWards.find(w => 
                            w.directorateName === item.directorateName && w.name === item.wardName
                          );
                          
                          if (ward) {
                            await addRequirement({
                              name: `${ward.name} - Support`,
                              minTechnicians: 1,
                              idealTechnicians: 1,
                              difficulty: ward.difficulty,
                              isActive: true,
                              requiresSpecialTraining: false,
                              category: "Ward"
                            });
                          }
                        }
                        
                        alert(`Successfully imported ${checkboxes.length} ward requirements`);
                        setShowImportOptions(false);
                      } catch (error) {
                        console.error("Error importing wards:", error);
                        alert("Failed to import ward requirements");
                      }
                    }}
                  >
                    Import Selected Wards
                  </button>
                </div>
                
                {/* Import Warfarin Clinics Section */}
                <div className="border p-4 rounded-md bg-gray-50">
                  <h4 className="font-medium text-lg mb-2">Import Warfarin Clinics</h4>
                  <p className="text-sm text-gray-500 mb-3">
                    Import active Warfarin clinics to create technician requirements for each clinic.
                  </p>
                  
                  <div className="max-h-60 overflow-y-auto mb-3 border rounded">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="py-2 px-3 text-left">Select</th>
                          <th className="py-2 px-3 text-left">Clinic</th>
                          <th className="py-2 px-3 text-left">Day</th>
                          <th className="py-2 px-3 text-left">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {warfarinClinics.map((clinic, idx) => (
                          <tr key={clinic._id} className="border-t hover:bg-gray-50">
                            <td className="py-2 px-3">
                              <input 
                                type="checkbox" 
                                name={`clinic-${idx}`}
                                id={`clinic-${idx}`}
                                value={clinic._id}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="py-2 px-3 font-medium">{clinic.name}</td>
                            <td className="py-2 px-3">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][clinic.dayOfWeek - 1]}</td>
                            <td className="py-2 px-3">{clinic.startTime} - {clinic.endTime}</td>
                          </tr>
                        ))}
                        {warfarinClinics.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-gray-500">
                              No Warfarin clinics found to import.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  <button 
                    type="button" 
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
                    disabled={warfarinClinics.length === 0}
                    onClick={async () => {
                      const checkboxes = document.querySelectorAll('input[name^="clinic-"]:checked');
                      if (checkboxes.length === 0) {
                        alert("Please select at least one clinic to import");
                        return;
                      }
                      
                      try {
                        // Convert to array and process selected clinics
                        const clinicIds = Array.from(checkboxes).map((cb: any) => cb.value);
                        
                        // Ensure we have the Warfarin training type
                        const warfarinTraining = trainingTypes.find(t => t.name === "Warfarin");
                        const trainingTypeToUse = warfarinTraining ? warfarinTraining.name : "Warfarin";
                        
                        for (const id of clinicIds) {
                          const clinic = warfarinClinics.find(c => c._id === id);
                          
                          if (clinic) {
                            // Create technician requirement for this clinic
                            // Use the clinic day in the name for clarity
                            const dayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][clinic.dayOfWeek - 1];
                            const clinicName = `${clinic.name} (${dayName}, ${clinic.startTime})`;
                            
                            await addRequirement({
                              name: clinicName,
                              minTechnicians: 1,
                              idealTechnicians: 1,
                              difficulty: 6, // Default difficulty
                              isActive: true,
                              requiresSpecialTraining: true,
                              trainingType: trainingTypeToUse,
                              category: "Ward" // Add to Ward category so it appears in the interface
                            });
                          }
                        }
                        
                        alert(`Successfully imported ${checkboxes.length} Warfarin clinics`);
                        setShowImportOptions(false);
                      } catch (error) {
                        console.error("Error importing clinics:", error);
                        alert("Failed to import clinic requirements");
                      }
                    }}
                  >
                    Import Selected Clinics
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end">
              <button
                type="button"
                className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300"
                onClick={() => setShowImportOptions(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
