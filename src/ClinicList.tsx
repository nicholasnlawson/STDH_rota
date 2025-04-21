import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function ClinicList() {
  const clinics = (useQuery(api.clinics.listClinics) || []).slice().sort((a, b) => {
    // Sort by dayOfWeek (1=Monday) then by startTime
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });
  const updateClinic = useMutation(api.clinics.updateClinic);
  const addClinic = useMutation(api.clinics.addClinic);
  const deleteClinic = useMutation(api.clinics.deleteClinic);
  const initializeClinics = useMutation(api.clinics.initializeClinics);
  const [showForm, setShowForm] = useState(false);
  const [selectedClinic, setSelectedClinic] = useState<any>(null);
  const pharmacists = useQuery(api.pharmacists.list) || [];

  function handleClinicSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const clinic = clinics.find(c => c._id === e.target.value);
    setSelectedClinic(clinic || null);
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
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
          {clinics.map(clinic => (
            <tr key={clinic._id} className="border-t">
              <td className="py-2 px-3 font-medium">{clinic.name}</td>
              <td className="py-2 px-3">{DAYS[clinic.dayOfWeek - 1]}</td>
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
                    setShowForm(true);
                    setSelectedClinic(clinic);
                  }}
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="bg-blue-600 text-white px-3 py-2 rounded mb-4 hover:bg-blue-700"
        onClick={() => { setShowForm(true); setSelectedClinic(null); }}
      >
        Add Clinic
      </button>
      {showForm && selectedClinic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Edit Clinic</h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold absolute top-2 right-4"
                onClick={() => { setShowForm(false); setSelectedClinic(null); }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex justify-end mb-4">
              <button
                type="button"
                className="bg-red-500 text-white px-4 py-2 rounded text-base font-medium hover:bg-red-600"
                onClick={async () => {
                  if (window.confirm('Are you sure you want to delete this clinic?')) {
                    await deleteClinic({ clinicId: selectedClinic._id });
                    setShowForm(false);
                    setSelectedClinic(null);
                  }
                }}
              >
                Delete
              </button>
            </div>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                await updateClinic({
                  clinicId: selectedClinic._id,
                  name: selectedClinic.name,
                  dayOfWeek: Number(selectedClinic.dayOfWeek),
                  startTime: selectedClinic.startTime,
                  endTime: selectedClinic.endTime,
                  coverageNote: selectedClinic.coverageNote,
                  isActive: selectedClinic.isActive,
                  requiresWarfarinTraining: selectedClinic.requiresWarfarinTraining ?? false,
                  travelTimeBefore: selectedClinic.travelTimeBefore ?? 0,
                  travelTimeAfter: selectedClinic.travelTimeAfter ?? 0,
                  isRegular: selectedClinic.isRegular ?? false,
                  includeByDefaultInRota: selectedClinic.includeByDefaultInRota ?? false,
                  preferredPharmacists: selectedClinic.preferredPharmacists || [],
                });
                setShowForm(false);
                setSelectedClinic(null);
              }}
            >
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="input-field mt-1"
                  value={selectedClinic.name}
                  onChange={e => setSelectedClinic({ ...selectedClinic, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Day</label>
                <select
                  className="input-field mt-1"
                  value={selectedClinic.dayOfWeek}
                  onChange={e => setSelectedClinic({ ...selectedClinic, dayOfWeek: Number(e.target.value) })}
                  required
                >
                  {DAYS.map((d, i) => (
                    <option key={i+1} value={i+1}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Time</label>
                <input
                  className="input-field mt-1"
                  type="time"
                  value={selectedClinic.startTime}
                  onChange={e => setSelectedClinic({ ...selectedClinic, startTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End Time</label>
                <input
                  className="input-field mt-1"
                  type="time"
                  value={selectedClinic.endTime}
                  onChange={e => setSelectedClinic({ ...selectedClinic, endTime: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Coverage Note</label>
                <input
                  className="input-field mt-1"
                  value={selectedClinic.coverageNote || ''}
                  onChange={e => setSelectedClinic({ ...selectedClinic, coverageNote: e.target.value })}
                />
              </div>
              {/* Preferred Pharmacists Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Pharmacists (drag to order)</label>
                <div className="border rounded p-2 bg-gray-50">
                  {selectedClinic.preferredPharmacists && selectedClinic.preferredPharmacists.length > 0 ? (
                    selectedClinic.preferredPharmacists.map((pid: string, idx: number) => {
                      const pharmacist = pharmacists.find((p: any) => p._id === pid);
                      return (
                        <div key={pid} className="flex items-center gap-2 mb-1">
                          <span className="flex-1">{pharmacist ? pharmacist.name : pid}</span>
                          <button
                            type="button"
                            className="text-xs text-gray-500 hover:text-gray-700"
                            disabled={idx === 0}
                            onClick={() => {
                              // Move up
                              if (idx > 0) {
                                const newList = [...selectedClinic.preferredPharmacists];
                                [newList[idx - 1], newList[idx]] = [newList[idx], newList[idx - 1]];
                                setSelectedClinic({ ...selectedClinic, preferredPharmacists: newList });
                              }
                            }}
                          >↑</button>
                          <button
                            type="button"
                            className="text-xs text-gray-500 hover:text-gray-700"
                            disabled={idx === selectedClinic.preferredPharmacists.length - 1}
                            onClick={() => {
                              // Move down
                              if (idx < selectedClinic.preferredPharmacists.length - 1) {
                                const newList = [...selectedClinic.preferredPharmacists];
                                [newList[idx + 1], newList[idx]] = [newList[idx], newList[idx + 1]];
                                setSelectedClinic({ ...selectedClinic, preferredPharmacists: newList });
                              }
                            }}
                          >↓</button>
                          <button
                            type="button"
                            className="text-xs text-red-500 hover:text-red-700"
                            onClick={() => {
                              const newList = selectedClinic.preferredPharmacists.filter((id: string) => id !== pid);
                              setSelectedClinic({ ...selectedClinic, preferredPharmacists: newList });
                            }}
                          >Remove</button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-xs text-gray-400">No preferred pharmacists selected.</div>
                  )}
                  {/* Add Pharmacist Dropdown */}
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      className="input-field flex-1"
                      value=""
                      onChange={e => {
                        const newId = e.target.value;
                        if (newId && !selectedClinic.preferredPharmacists?.includes(newId)) {
                          setSelectedClinic({
                            ...selectedClinic,
                            preferredPharmacists: [...(selectedClinic.preferredPharmacists || []), newId],
                          });
                        }
                      }}
                    >
                      <option value="">Add pharmacist…</option>
                      {pharmacists
                        .filter((p: any) => !selectedClinic.preferredPharmacists?.includes(p._id))
                        .map((p: any) => (
                          <option key={p._id} value={p._id}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!selectedClinic.isActive}
                    onChange={e => setSelectedClinic({ ...selectedClinic, isActive: e.target.checked })}
                  />
                  <span className="ml-2">Active</span>
                </label>
                <label className="flex items-center text-sm font-medium">
                  <input
                    type="checkbox"
                    name="includeByDefaultInRota"
                    checked={selectedClinic?.includeByDefaultInRota ?? false}
                    onChange={e => setSelectedClinic({ ...selectedClinic, includeByDefaultInRota: e.target.checked })}
                  />
                  <span className="ml-2">Include by Default in Rota</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300"
                  onClick={() => { setShowForm(false); setSelectedClinic(null); }}
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
      {showForm && !selectedClinic && (
        <form
          className="bg-gray-50 p-4 rounded shadow mb-4 flex flex-col gap-3 max-w-md"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target as typeof e.target & {
              name: { value: string };
              dayOfWeek: { value: string };
              startTime: { value: string };
              endTime: { value: string };
              coverageNote: { value: string };
              isActive: { checked: boolean };
              includeByDefaultInRota: { checked: boolean };
            };
            await addClinic({
              name: form.name.value,
              dayOfWeek: Number(form.dayOfWeek.value),
              startTime: form.startTime.value,
              endTime: form.endTime.value,
              coverageNote: form.coverageNote.value,
              isActive: form.isActive.checked,
              includeByDefaultInRota: form.includeByDefaultInRota.checked,
            });
            setShowForm(false);
          }}
        >
          <h3 className="font-semibold text-lg mb-2">Add Clinic</h3>
          <label className="text-sm font-medium">Name
            <input className="input-field mt-1" name="name" required />
          </label>
          <label className="text-sm font-medium">Day
            <select className="input-field mt-1" name="dayOfWeek" required>
              {DAYS.map((d, i) => (
                <option key={i+1} value={i+1}>{d}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">Start Time
            <input className="input-field mt-1" type="time" name="startTime" required />
          </label>
          <label className="text-sm font-medium">End Time
            <input className="input-field mt-1" type="time" name="endTime" required />
          </label>
          <label className="text-sm font-medium">Coverage Note
            <input className="input-field mt-1" name="coverageNote" />
          </label>
          <label className="text-sm font-medium flex items-center gap-2">Active
            <input type="checkbox" name="isActive" defaultChecked />
          </label>
          <label className="text-sm font-medium flex items-center gap-2">Include by Default in Rota
            <input type="checkbox" name="includeByDefaultInRota" defaultChecked={false} />
          </label>
          <div className="flex gap-2 mt-2">
            <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">Add</button>
            <button type="button" className="bg-gray-300 text-gray-800 px-3 py-1 rounded hover:bg-gray-400" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
