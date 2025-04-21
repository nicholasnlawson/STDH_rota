import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export function RequirementsList() {
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  const updateWard = useMutation(api.requirements.updateWard);
  const initializeDirectorates = useMutation(api.requirements.initializeDirectorates);
  const updateDirectorateSpecialTrainingTypes = useMutation(api.requirements.updateDirectorateSpecialTrainingTypes);
  const deleteWard = useMutation(api.requirements.deleteWard);
  const addWard = useMutation(api.requirements.addWard);
  const updateDirectorateSpecialTrainingTypesAndRemoveFromPharmacists = useMutation(api.requirements.updateDirectorateSpecialTrainingTypesAndRemoveFromPharmacists);
  const [showForm, setShowForm] = useState(false);
  const [selectedDirectorate, setSelectedDirectorate] = useState("");
  const [selectedWard, setSelectedWard] = useState("");
  const [requiresSpecialTraining, setRequiresSpecialTraining] = useState(false);
  const [trainingType, setTrainingType] = useState("");

  const selectedDirectorateData = directorates.find(d => d.name === selectedDirectorate);
  const selectedWardData = selectedDirectorateData?.wards.find(w => w.name === selectedWard);

  // Fetch all unique special training types from directorates
  const allSpecialTrainingTypes = Array.from(new Set(
    directorates.flatMap(d => d.specialTrainingTypes || ["ITU"])
  ));

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-semibold mb-4">Ward Requirements</h2>

      {/* Unified ward requirements table, similar to clinics */}
      <table className="min-w-full mb-8 border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="py-2 px-3 text-left">Directorate</th>
            <th className="py-2 px-3 text-left">Ward</th>
            <th className="py-2 px-3 text-left">Min</th>
            <th className="py-2 px-3 text-left">Ideal</th>
            <th className="py-2 px-3 text-left">Weighting</th>
            <th className="py-2 px-3 text-left">Special Training</th>
            <th className="py-2 px-3 text-left">Active</th>
            <th className="py-2 px-3 text-left">Edit</th>
          </tr>
        </thead>
        <tbody>
          {directorates.flatMap((dir) =>
            dir.wards.map((ward) => (
              <tr key={dir.name + ward.name} className="border-t">
                <td className="py-2 px-3">{dir.name}</td>
                <td className="py-2 px-3 font-medium">{ward.name}</td>
                <td className="py-2 px-3">{ward.minPharmacists}</td>
                <td className="py-2 px-3">{ward.idealPharmacists}</td>
                <td className="py-2 px-3">{ward.difficulty}/10</td>
                <td className="py-2 px-3 text-xs text-gray-600">
                  {ward.requiresSpecialTraining ? (ward.trainingType || "Yes") : "No"}
                </td>
                <td className="py-2 px-3">
                  {ward.isActive ? (
                    <span className="text-green-600">Active</span>
                  ) : (
                    <span className="text-gray-400">Inactive</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <button
                    className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                    onClick={() => {
                      setShowForm(true);
                      setSelectedDirectorate(dir.name);
                      setSelectedWard(ward.name);
                      setRequiresSpecialTraining(ward.requiresSpecialTraining);
                      setTrainingType(ward.trainingType || "");
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="mb-8">
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded text-base font-medium hover:bg-blue-600"
          onClick={() => {
            setSelectedDirectorate("");
            setSelectedWard("");
            setShowForm(true);
            setRequiresSpecialTraining(false);
            setTrainingType("");
          }}
        >
          Add Ward
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">
                {selectedWard ? "Edit Ward" : "Add Ward"}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold absolute top-2 right-4"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {selectedWard && (
              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  className="bg-red-500 text-white px-4 py-2 rounded text-base font-medium hover:bg-red-600"
                  onClick={async () => {
                    if (window.confirm(`Delete ward '${selectedWardData?.name}' from '${selectedDirectorate}'?`)) {
                      await deleteWard({ directorateName: selectedDirectorate, wardName: selectedWard });
                      setShowForm(false);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const formData = new FormData(form);
                const shouldUseSpecialTraining = requiresSpecialTraining;
                const trainingTypeValue = shouldUseSpecialTraining ? trainingType : "";
                if (!selectedWard) {
                  // Add new ward
                  await addWard({
                    directorateName: selectedDirectorate,
                    ward: {
                      name: formData.get("wardName") as string,
                      minPharmacists: parseFloat(formData.get("minPharmacists") as string),
                      idealPharmacists: parseFloat(formData.get("idealPharmacists") as string),
                      isActive: formData.get("isActive") === "on",
                      requiresSpecialTraining: shouldUseSpecialTraining,
                      trainingType: trainingTypeValue,
                      difficulty: parseInt(formData.get("difficulty") as string),
                    },
                  });
                } else {
                  // Update existing ward
                  await updateWard({
                    directorateName: selectedDirectorate,
                    wardName: selectedWard,
                    minPharmacists: parseFloat(formData.get("minPharmacists") as string),
                    idealPharmacists: parseFloat(formData.get("idealPharmacists") as string),
                    isActive: formData.get("isActive") === "on",
                    requiresSpecialTraining: shouldUseSpecialTraining,
                    trainingType: trainingTypeValue,
                    difficulty: parseInt(formData.get("difficulty") as string),
                  });
                }
                setShowForm(false);
                form.reset();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700">Directorate</label>
                <select
                  value={selectedDirectorate}
                  onChange={(e) => {
                    setSelectedDirectorate(e.target.value);
                    setSelectedWard("");
                  }}
                  required
                  disabled={!!selectedWard}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select Directorate</option>
                  {directorates.map((d) => (
                    <option key={d._id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Ward Name</label>
                <input
                  type="text"
                  name="wardName"
                  defaultValue={selectedWardData?.name || ""}
                  required={!selectedWard}
                  disabled={!!selectedWard}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Minimum Pharmacists</label>
                <input
                  type="number"
                  name="minPharmacists"
                  defaultValue={selectedWardData?.minPharmacists || ""}
                  required
                  min="0"
                  step="0.5"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Ideal Pharmacists</label>
                <input
                  type="number"
                  name="idealPharmacists"
                  defaultValue={selectedWardData?.idealPharmacists || ""}
                  required
                  min="0"
                  step="0.5"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Weighting (1-10)</label>
                <input
                  type="number"
                  name="difficulty"
                  defaultValue={selectedWardData?.difficulty || ""}
                  required
                  min="1"
                  max="10"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={selectedWardData?.isActive ?? true}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="ml-2">Active</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="requiresSpecialTraining"
                    checked={requiresSpecialTraining}
                    onChange={e => setRequiresSpecialTraining(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="ml-2">Requires Special Training</span>
                </label>
              </div>
              {requiresSpecialTraining && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Training Type</label>
                  <select
                    name="trainingType"
                    value={trainingType}
                    onChange={e => setTrainingType(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    {allSpecialTrainingTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
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
      {/* Section to manage specialist training types */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Specialist Training Types</label>
        <div className="flex gap-2 flex-wrap mb-2">
          {allSpecialTrainingTypes.map(type => (
            <span key={type} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center gap-1">
              <span
                className="cursor-pointer hover:underline"
                onClick={async () => {
                  // Prompt for new name
                  const newName = window.prompt(`Edit specialist training type:`, type);
                  if (newName && newName.trim() && newName !== type) {
                    // Update all directorates that have this type
                    await Promise.all(
                      directorates.map(async d => {
                        const currentTypes = d.specialTrainingTypes || ["ITU"];
                        if (currentTypes.includes(type)) {
                          const updatedTypes = currentTypes.map(t => (t === type ? newName.trim() : t));
                          await updateDirectorateSpecialTrainingTypes({
                            name: d.name,
                            specialTrainingTypes: updatedTypes,
                          });
                        }
                      })
                    );
                  }
                }}
                title="Click to edit name"
              >
                {type}
              </span>
              <button
                className="ml-1 text-red-500 hover:text-red-700 font-bold text-xs"
                title="Delete type"
                onClick={async () => {
                  if (window.confirm(`Are you sure you wish to delete '${type}'? This will remove existing tags from Pharmacist data.`)) {
                    // Remove from all directorates and from all pharmacists
                    await Promise.all(
                      directorates.map(async d => {
                        const currentTypes = d.specialTrainingTypes || ["ITU"];
                        if (currentTypes.includes(type)) {
                          const updatedTypes = currentTypes.filter(t => t !== type);
                          await updateDirectorateSpecialTrainingTypesAndRemoveFromPharmacists({
                            name: d.name,
                            specialTrainingTypes: updatedTypes,
                            deletedTypes: [type],
                          });
                        }
                      })
                    );
                  }
                }}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={async e => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const newType = form.newTrainingType.value.trim();
          if (newType && !allSpecialTrainingTypes.includes(newType)) {
            // Save to all directorates for now (could be per directorate)
            await Promise.all(
              directorates.map(async d => {
                const currentTypes = d.specialTrainingTypes || ["ITU"];
                if (!currentTypes.includes(newType)) {
                  await updateDirectorateSpecialTrainingTypes({
                    name: d.name,
                    specialTrainingTypes: [...currentTypes, newType],
                  });
                }
              })
            );
          }
          form.reset();
        }} className="flex gap-2 mt-2">
          <input name="newTrainingType" className="border rounded px-2 py-1 text-sm" placeholder="Add new type (e.g. Oncology)" />
          <button type="submit" className="bg-blue-500 text-white px-2 py-1 rounded text-xs">Add</button>
        </form>
      </div>
    </div>
  );
}
