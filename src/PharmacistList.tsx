import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

export function PharmacistList() {
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const addPharmacist = useMutation(api.pharmacists.add);
  const removePharmacist = useMutation(api.pharmacists.remove);
  const updatePharmacist = useMutation(api.pharmacists.update);
  const directorates = useQuery(api.requirements.listDirectorates) || [];

  // Fetch all unique special training types from directorates
  const allSpecialTrainingTypes = Array.from(new Set(
    directorates.flatMap(d => d.specialTrainingTypes || ["ITU"])
  ));

  // Fix type errors: explicitly type formData and editFormData
  type NotAvailableRule = {
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  };
  type PharmacistFormData = {
    name: string;
    email: string;
    band: string;
    primaryDirectorate: string;
    warfarinTrained: boolean;
    ituTrained: boolean;
    specialistTraining: string[];
    isDefaultPharmacist: boolean;
    preferences: string[];
    availability: string[];
    isAdmin: boolean;
    trainedDirectorates: string[];
    primaryWards: string[];
    workingDays: string[];
    notAvailableRules?: NotAvailableRule[];
  };

  const [formData, setFormData] = useState<PharmacistFormData>({
    name: "",
    email: "",
    band: "6",
    primaryDirectorate: "",
    warfarinTrained: false,
    ituTrained: false,
    specialistTraining: [],
    isDefaultPharmacist: true,
    preferences: [],
    availability: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    isAdmin: false,
    trainedDirectorates: [],
    primaryWards: [],
    workingDays: [],
    notAvailableRules: [],
  });

  const [editingId, setEditingId] = useState<Id<"pharmacists"> | null>(null);
  const [editFormData, setEditFormData] = useState<PharmacistFormData | null>(null);

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const filteredPharmacists = pharmacists.filter(pharmacist =>
    pharmacist.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await addPharmacist({ ...formData, ituTrained: false }); // keep for backend compatibility
    setFormData({
      name: "",
      email: "",
      band: "6",
      primaryDirectorate: "",
      warfarinTrained: false,
      ituTrained: false,
      specialistTraining: [],
      isDefaultPharmacist: true,
      preferences: [],
      availability: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      isAdmin: false,
      trainedDirectorates: [],
      primaryWards: [],
      workingDays: [],
      notAvailableRules: [],
    });
  }

  function handleEditClick(pharmacist: any) {
    setEditingId(pharmacist._id);
    setEditFormData({
      ...pharmacist,
      workingDays: Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : [],
      notAvailableRules: Array.isArray(pharmacist.notAvailableRules) ? pharmacist.notAvailableRules : [],
      specialistTraining: Array.isArray(pharmacist.specialistTraining) ? pharmacist.specialistTraining : [],
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId && editFormData) {
      // Remove Convex system fields before sending to updatePharmacist (runtime only)
      const { _id, _creationTime, ...rest } = (editFormData as any);
      const safeEditFormData: PharmacistFormData = {
        ...rest,
        preferences: rest.preferences || [],
        availability: rest.availability || [],
        trainedDirectorates: rest.trainedDirectorates || [],
        primaryWards: rest.primaryWards || [],
        workingDays: rest.workingDays || [],
        notAvailableRules: rest.notAvailableRules || [],
        specialistTraining: rest.specialistTraining || [],
        ituTrained: false, // keep for backend compatibility
      };
      await updatePharmacist({ id: editingId, ...safeEditFormData });
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
      <h2 className="text-2xl font-semibold mb-4">Pharmacists</h2>

      <form onSubmit={handleSubmit} className="space-y-4 mb-8">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded border-gray-300"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              className="w-full rounded border-gray-300"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Band</label>
            <select
              value={formData.band}
              onChange={e => {
                const band = e.target.value;
                setFormData(f => ({ ...f, band,
                  ...(band === 'Dispensary Pharmacist' || band === 'EAU Practitioner' ? {
                    warfarinTrained: false,
                    specialistTraining: [],
                    isDefaultPharmacist: false,
                    isAdmin: false,
                    trainedDirectorates: [],
                    primaryDirectorate: '',
                    primaryWards: [],
                    preferences: [],
                    availability: [],
                  } : {})
                }));
              }}
              className="w-full rounded border-gray-300"
              required
            >
              {["6", "7", "8a", "Dispensary Pharmacist", "EAU Practitioner"].map(band => (
                <option key={band} value={band}>{band}</option>
              ))}
            </select>
          </div>
          {/* Only show Trained in Directorates if not Dispensary or Practitioner */}
          {!(formData.band === "Dispensary Pharmacist" || formData.band === "EAU Practitioner") && (
            <div>
              <label className="block text-sm font-medium mb-1">Trained in Directorates <span className="text-xs text-gray-400">(optional)</span></label>
              <div className="flex flex-col space-y-1">
                {Array.isArray(directorates) && directorates.length > 0 ? (
                  directorates.map(d => (
                    <label key={d._id || d.name} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.trainedDirectorates.includes(d.name)}
                        onChange={e => {
                          const updated = e.target.checked
                            ? [...formData.trainedDirectorates, d.name]
                            : formData.trainedDirectorates.filter(name => name !== d.name);
                          setFormData(f => ({ ...f, trainedDirectorates: updated }));
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">{d.name}</span>
                    </label>
                  ))
                ) : (
                  <span className="text-gray-500 text-sm">No directorates available yet. You can add these later in Ward Requirements.</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Default Working Days</label>
          <div className="flex gap-2 flex-wrap">
            {["Monday","Tuesday","Wednesday","Thursday","Friday"].map(day => (
              <label key={day} className="flex items-center space-x-1">
                <input
                  type="checkbox"
                  checked={formData.workingDays.includes(day)}
                  onChange={e => {
                    setFormData(f => {
                      const updated = e.target.checked
                        ? [...f.workingDays, day]
                        : f.workingDays.filter(d => d !== day);
                      return { ...f, workingDays: updated };
                    });
                  }}
                />
                <span className="text-sm">{day}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Not Available Rules</label>
          {(formData.notAvailableRules || []).map((rule, idx) => (
            <div key={idx} className="flex items-center space-x-2 mb-1">
              <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
              <button type="button" className="text-xs text-red-500" onClick={() => {
                const rules = [...formData.notAvailableRules!];
                rules.splice(idx, 1);
                setFormData(f => ({ ...f, notAvailableRules: rules }));
              }}>Remove</button>
            </div>
          ))}
          <div className="flex items-center space-x-2 mt-2">
            <select className="rounded border-gray-300" id="naDay" defaultValue="Monday">
              {['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => <option key={day} value={day}>{day}</option>)}
            </select>
            <input type="time" id="naStart" className="rounded border-gray-300" defaultValue="13:00" />
            <input type="time" id="naEnd" className="rounded border-gray-300" defaultValue="17:00" />
            <button type="button" className="text-xs text-blue-500" onClick={e => {
              const parent = (e.target as HTMLElement).parentElement!;
              const day = (parent.querySelector('#naDay') as HTMLSelectElement).value;
              const start = (parent.querySelector('#naStart') as HTMLInputElement).value;
              const end = (parent.querySelector('#naEnd') as HTMLInputElement).value;
              if (!day || !start || !end) return;
              const newRule = { dayOfWeek: day, startTime: start, endTime: end };
              setFormData(f => ({ ...f, notAvailableRules: [...(f.notAvailableRules||[]), newRule] }));
            }}>Add</button>
          </div>
        </div>

        {/* Specialist Training */}
        <div>
          <label className="block text-sm font-medium mb-1">Specialist Training</label>
          <div className="flex flex-wrap gap-2">
            {allSpecialTrainingTypes.map(type => (
              <label key={type} className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 rounded">
                <input
                  type="checkbox"
                  checked={formData.specialistTraining?.includes(type)}
                  onChange={e => {
                    setFormData({
                      ...formData,
                      specialistTraining: e.target.checked
                        ? [...(formData.specialistTraining || []), type]
                        : (formData.specialistTraining || []).filter(t => t !== type)
                    });
                  }}
                />
                {type}
              </label>
            ))}
          </div>
        </div>

        {!(["Dispensary Pharmacist", "EAU Practitioner"].includes(formData.band)) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Primary Directorate <span className="text-xs text-gray-400">(optional)</span></label>
                <select
                  value={formData.primaryDirectorate}
                  onChange={e => setFormData({ ...formData, primaryDirectorate: e.target.value, primaryWards: [] })}
                  className="w-full rounded border-gray-300"
                >
                  <option value="">Select...</option>
                  {Array.isArray(directorates) && directorates.length > 0 && directorates.map(d => (
                    <option key={d._id || d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
              {formData.primaryDirectorate && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Primary Ward(s) <span className="text-xs text-gray-400">(optional)</span></label>
                  <div className="flex flex-col space-y-1">
                    {(Array.isArray(directorates) && directorates.find(d => d.name === formData.primaryDirectorate)?.wards || []).map(ward => (
                      <label key={ward.name} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.primaryWards.includes(ward.name)}
                          onChange={e => {
                            setFormData(prev => {
                              const updated = e.target.checked
                                ? [...prev.primaryWards, ward.name]
                                : prev.primaryWards.filter(name => name !== ward.name);
                              return { ...prev, primaryWards: updated };
                            });
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm">{ward.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.warfarinTrained}
                    onChange={e => setFormData({ ...formData, warfarinTrained: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Warfarin Trained</span>
                </label>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isDefaultPharmacist}
                    onChange={e => setFormData({ ...formData, isDefaultPharmacist: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Default Pharmacist</span>
                </label>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.isAdmin}
                    onChange={e => setFormData({ ...formData, isAdmin: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">Admin Access</span>
                </label>
              </div>
            </div>
          </>
        )}
        {(["Dispensary Pharmacist", "EAU Practitioner"].includes(formData.band)) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isDefaultPharmacist}
                  onChange={e => setFormData({ ...formData, isDefaultPharmacist: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium">Default Pharmacist</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isAdmin}
                  onChange={e => setFormData({ ...formData, isAdmin: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium">Admin</span>
              </label>
            </div>
          </div>
        )}
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Add Pharmacist
        </button>
      </form>

      {/* Search Pharmacists */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Search Pharmacists</label>
        <input
          type="text"
          placeholder="Type to search..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full rounded border-gray-300"
        />
      </div>

      {searchTerm && (
        <div className="space-y-4">
          {filteredPharmacists.map(pharmacist => (
            <div key={pharmacist._id} className="border rounded p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium cursor-pointer underline hover:text-blue-600" onClick={() => handleEditClick(pharmacist)}>{pharmacist.name}</h3>
                  <p className="text-sm text-gray-500">{pharmacist.email}</p>
                  {pharmacist.band === "Dispensary Pharmacist" ? (
                    <p className="text-sm">Dispensary Pharmacist{pharmacist.primaryDirectorate ? ` - ${pharmacist.primaryDirectorate}` : ''}</p>
                  ) : pharmacist.band === "EAU Practitioner" ? (
                    <p className="text-sm">EAU Practitioner{pharmacist.primaryDirectorate ? ` - ${pharmacist.primaryDirectorate}` : ''}</p>
                  ) : (
                    <p className="text-sm">Band {pharmacist.band}{pharmacist.primaryDirectorate ? ` - ${pharmacist.primaryDirectorate}` : ''}</p>
                  )}
                  <div className="text-sm mt-2 flex flex-wrap gap-2">
                    {pharmacist.band === "Dispensary Pharmacist" && (
                      <span className="px-2 py-1 bg-purple-100 border border-purple-300 text-purple-800 rounded-full text-xs">Dispensary Pharmacist</span>
                    )}
                    {pharmacist.band === "EAU Practitioner" && (
                      <span className="px-2 py-1 bg-blue-900 border border-blue-900 text-white rounded-full text-xs">EAU Practitioner</span>
                    )}
                    {!["Dispensary Pharmacist", "EAU Practitioner"].includes(pharmacist.band) && (
                      <>
                        {pharmacist.warfarinTrained && <span className="px-2 py-1 bg-red-100 border border-red-300 text-red-800 rounded-full text-xs">Warfarin</span>}
                        {Array.isArray(pharmacist.specialistTraining) && pharmacist.specialistTraining.map((type: string) => (
                          <span key={type} className="px-2 py-1 bg-green-100 border border-green-300 text-green-800 rounded-full text-xs">{type}</span>
                        ))}
                        {pharmacist.isAdmin && <span className="px-2 py-1 bg-gray-200 border border-gray-400 text-gray-800 rounded-full text-xs">Admin</span>}
                        {Array.isArray(pharmacist.trainedDirectorates) && pharmacist.trainedDirectorates.map((dir: string) => (
                          <span key={dir} className="px-2 py-1 bg-green-100 border border-green-300 text-green-800 rounded-full text-xs">{dir}</span>
                        ))}
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removePharmacist({ id: pharmacist._id })}
                  className="text-red-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              {editingId === pharmacist._id && editFormData && (
                <form onSubmit={handleEditSubmit} className="mt-4 space-y-4 bg-gray-50 p-4 rounded">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Name</label>
                      <input
                        type="text"
                        value={editFormData.name}
                        onChange={e => setEditFormData(f => f && { ...f, name: e.target.value })}
                        className="w-full rounded border-gray-300"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Email</label>
                      <input
                        type="email"
                        value={editFormData.email}
                        onChange={e => setEditFormData(f => f && { ...f, email: e.target.value })}
                        className="w-full rounded border-gray-300"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Band</label>
                      <select
                        value={editFormData.band}
                        onChange={e => {
                          const band = e.target.value;
                          setEditFormData(f => f && { ...f, band,
                            ...(band === 'Dispensary Pharmacist' || band === 'EAU Practitioner' ? {
                              warfarinTrained: false,
                              specialistTraining: [],
                              isDefaultPharmacist: false,
                              isAdmin: false,
                              trainedDirectorates: [],
                              primaryDirectorate: '',
                              primaryWards: [],
                              preferences: [],
                              availability: [],
                            } : {})
                          });
                        }}
                        className="w-full rounded border-gray-300"
                        required
                      >
                        {["6", "7", "8a", "Dispensary Pharmacist", "EAU Practitioner"].map(band => (
                          <option key={band} value={band}>{band}</option>
                        ))}
                      </select>
                    </div>
                    {/* Only show Trained in Directorates if not Dispensary or Practitioner */}
                    {!(editFormData && (editFormData.band === "Dispensary Pharmacist" || editFormData.band === "EAU Practitioner")) && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Trained in Directorates <span className="text-xs text-gray-400">(optional)</span></label>
                        <div className="flex flex-col space-y-1">
                          {Array.isArray(directorates) && directorates.length > 0 ? (
                            directorates.map(d => (
                              <label key={d._id || d.name} className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  checked={editFormData.trainedDirectorates.includes(d.name)}
                                  onChange={e => {
                                    setEditFormData(f => {
                                      if (!f) return f;
                                      const updated = e.target.checked
                                        ? [...f.trainedDirectorates, d.name]
                                        : f.trainedDirectorates.filter(name => name !== d.name);
                                      return { ...f, trainedDirectorates: updated };
                                    });
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm">{d.name}</span>
                              </label>
                            ))
                          ) : (
                            <span className="text-gray-500 text-sm">No directorates available yet. You can add these later in Ward Requirements.</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Default Working Days</label>
                    <div className="flex gap-2 flex-wrap">
                      {["Monday","Tuesday","Wednesday","Thursday","Friday"].map(day => (
                        <label key={day} className="flex items-center space-x-1">
                          <input
                            type="checkbox"
                            checked={editFormData.workingDays.includes(day)}
                            onChange={e => {
                              setEditFormData(f => {
                                if (!f) return f;
                                const updated = e.target.checked
                                  ? [...f.workingDays, day]
                                  : f.workingDays.filter(d => d !== day);
                                return { ...f, workingDays: updated };
                              });
                            }}
                          />
                          <span className="text-sm">{day}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Not Available Rules</label>
                    {(editFormData.notAvailableRules || []).map((rule, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-1">
                        <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                        <button type="button" className="text-xs text-red-500" onClick={() => {
                          const rules = [...editFormData.notAvailableRules!];
                          rules.splice(idx, 1);
                          setEditFormData(f => f && ({ ...f, notAvailableRules: rules }));
                        }}>Remove</button>
                      </div>
                    ))}
                    <div className="flex items-center space-x-2 mt-2">
                      <select className="rounded border-gray-300" id="naDay" defaultValue="Monday">
                        {['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => <option key={day} value={day}>{day}</option>)}
                      </select>
                      <input type="time" id="naStart" className="rounded border-gray-300" defaultValue="13:00" />
                      <input type="time" id="naEnd" className="rounded border-gray-300" defaultValue="17:00" />
                      <button type="button" className="text-xs text-blue-500" onClick={e => {
                        const parent = (e.target as HTMLElement).parentElement!;
                        const day = (parent.querySelector('#naDay') as HTMLSelectElement).value;
                        const start = (parent.querySelector('#naStart') as HTMLInputElement).value;
                        const end = (parent.querySelector('#naEnd') as HTMLInputElement).value;
                        if (!day || !start || !end) return;
                        const newRule = { dayOfWeek: day, startTime: start, endTime: end };
                        setEditFormData(f => f && ({ ...f, notAvailableRules: [...(f.notAvailableRules||[]), newRule] }));
                      }}>Add</button>
                    </div>
                  </div>

                  {/* Specialist Training */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Specialist Training</label>
                    <div className="flex flex-wrap gap-2">
                      {allSpecialTrainingTypes.map(type => (
                        <label key={type} className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 rounded">
                          <input
                            type="checkbox"
                            checked={editFormData.specialistTraining?.includes(type)}
                            onChange={e => {
                              setEditFormData(f => {
                                if (!f) return f;
                                const updated = e.target.checked
                                  ? [...f.specialistTraining, type]
                                  : f.specialistTraining.filter(t => t !== type);
                                return { ...f, specialistTraining: updated };
                              });
                            }}
                          />
                          {type}
                        </label>
                      ))}
                    </div>
                  </div>

                  {!(["Dispensary Pharmacist", "EAU Practitioner"].includes(editFormData.band)) && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Primary Directorate <span className="text-xs text-gray-400">(optional)</span></label>
                          <select
                            value={editFormData.primaryDirectorate}
                            onChange={e => setEditFormData(f => f && { ...f, primaryDirectorate: e.target.value, primaryWards: [] })}
                            className="w-full rounded border-gray-300"
                          >
                            <option value="">Select...</option>
                            {Array.isArray(directorates) && directorates.length > 0 && directorates.map(d => (
                              <option key={d._id || d.name} value={d.name}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                        {editFormData.primaryDirectorate && (
                          <div className="mb-4">
                            <label className="block text-sm font-medium mb-1">Primary Ward(s) <span className="text-xs text-gray-400">(optional)</span></label>
                            <div className="flex flex-col space-y-1">
                              {(Array.isArray(directorates) && directorates.find(d => d.name === editFormData.primaryDirectorate)?.wards || []).map(ward => (
                                <label key={ward.name} className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={editFormData.primaryWards.includes(ward.name)}
                                    onChange={e => {
                                      setEditFormData(f => {
                                        if (!f) return f;
                                        const updated = e.target.checked
                                          ? [...f.primaryWards, ward.name]
                                          : f.primaryWards.filter(name => name !== ward.name);
                                        return { ...f, primaryWards: updated };
                                      });
                                    }}
                                    className="rounded border-gray-300"
                                  />
                                  <span className="text-sm">{ward.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={editFormData.warfarinTrained}
                              onChange={e => setEditFormData(f => f && { ...f, warfarinTrained: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium">Warfarin Trained</span>
                          </label>
                        </div>
                        <div>
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={editFormData.isDefaultPharmacist}
                              onChange={e => setEditFormData(f => f && { ...f, isDefaultPharmacist: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium">Default Pharmacist</span>
                          </label>
                        </div>
                        <div>
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={editFormData.isAdmin}
                              onChange={e => setEditFormData(f => f && { ...f, isAdmin: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium">Admin Access</span>
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                  {(["Dispensary Pharmacist", "EAU Practitioner"].includes(editFormData.band)) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={editFormData.isDefaultPharmacist}
                            onChange={e => setEditFormData(f => f && { ...f, isDefaultPharmacist: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm font-medium">Default Pharmacist</span>
                        </label>
                      </div>
                      <div>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={editFormData.isAdmin}
                            onChange={e => setEditFormData(f => f && { ...f, isAdmin: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm font-medium">Admin</span>
                        </label>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-4 mt-4">
                    <button
                      type="submit"
                      className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500"
                      onClick={handleEditCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
