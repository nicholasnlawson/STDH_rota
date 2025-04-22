import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLINIC_DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function RotaView() {
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const generateWeeklyRota = useMutation(api.rotas.generateWeeklyRota);
  const clinics = useQuery(api.clinics.listClinics) || [];
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  const [selectedClinicIds, setSelectedClinicIds] = useState<Array<Id<"clinics">>>([]);
  const [selectedPharmacistIds, setSelectedPharmacistIds] = useState<Array<Id<"pharmacists">>>(() => {
    // Preselect default pharmacists
    return (pharmacists.filter((p: any) => p.isDefaultPharmacist).map((p: any) => p._id) || []);
  });
  const [selectedMonday, setSelectedMonday] = useState("");
  const [generatingWeekly, setGeneratingWeekly] = useState(false);
  const [showClinicSelection, setShowClinicSelection] = useState(false);
  const [showPharmacistSelection, setShowPharmacistSelection] = useState(false);
  const [rotaGenerated, setRotaGenerated] = useState(false);
  const [pharmacistWorkingDays, setPharmacistWorkingDays] = useState<Record<string, string[]>>({});
  const allRotas = useQuery(api.rotas.listRotas) || [];
  const [rotaAssignments, setRotaAssignments] = useState<any[]>([]);
  const [rotaUnavailableRules, setRotaUnavailableRules] = useState<Record<string, { dayOfWeek: string, startTime: string, endTime: string }[]>>({});
  const [singlePharmacistDispensaryDays, setSinglePharmacistDispensaryDays] = useState<string[]>([]);
  const [pharmacistSearch, setPharmacistSearch] = useState("");

  // Log rotaAssignments changes
  useEffect(() => {
    console.log('[useEffect rotaAssignments] Rota assignments updated:', rotaAssignments);
  }, [rotaAssignments]);

  // Helper: Get all wards with directorate info
  const allWards = directorates.flatMap((d: any) => (d.wards || []).map((w: any) => ({...w, directorate: d.name})));

  // Define rota time slots
  const TIME_SLOTS = [
    { start: "09:00", end: "11:00" },
    { start: "11:00", end: "13:00" },
    { start: "13:00", end: "15:00" },
    { start: "15:00", end: "17:00" },
  ];

  // Helper: get assignments for a given day, ward, and slot
  function getWardAssignment(
    date: string,
    ward: string,
    slot: { start: string; end: string }
  ) {
    const found = rotaAssignments.find(a =>
      a.type === "ward" &&
      a.date === date &&
      a.location === ward &&
      a.startTime <= slot.start &&
      a.endTime >= slot.end
    );
    console.log('[getWardAssignment]', found ? "Found:" : "Not found:", { date, ward, slot, found });
    return found;
  }

  // Helper: get assignments for clinic for a given date and clinic
  function getClinicAssignment(
    date: string,
    clinicName: string
  ) {
    const found = rotaAssignments.find(a =>
      a.type === "clinic" &&
      a.date === date &&
      a.location === clinicName
    );
    
    console.log('[getClinicAssignment]', found ? "Found:" : "Not found:", { date, clinicName, found });
    return found;
  }

  // Helper: get assignments for dispensary for a given date and slot
  function getDispensaryAssignment(
    date: string,
    slot: { start: string; end: string }
  ) {
    // First try to find an exact match for the time slot
    const found = rotaAssignments.find(a =>
      a.date === date &&
      a.type === "dispensary" &&
      a.startTime === slot.start &&
      a.endTime === slot.end
    );
    
    if (found) {
      console.log('[getDispensaryAssignment] Found:', { date, slot, found });
      return found;
    } else {
      // Check if this is a lunch slot by trying to find a lunch cover assignment
      const lunchCover = rotaAssignments.find(a =>
        a.date === date &&
        a.type === "dispensary" &&
        a.isLunchCover === true &&
        a.startTime <= slot.end &&
        a.endTime >= slot.start
      );
      
      if (lunchCover) {
        console.log('[getDispensaryAssignment] Found lunch cover:', { date, slot, lunchCover });
        return lunchCover;
      }
      
      // If no exact match and not a lunch slot, check if there's a regular dispensary assignment
      // that overlaps with this slot (e.g., a pharmacist assigned for the whole day)
      const overlapping = rotaAssignments.find(a =>
        a.date === date &&
        a.type === "dispensary" &&
        !a.isLunchCover &&
        a.startTime <= slot.start &&
        a.endTime >= slot.end
      );
      
      if (overlapping) {
        console.log('[getDispensaryAssignment] Found overlapping:', { date, slot, overlapping });
        return overlapping;
      }
      
      console.log('[getDispensaryAssignment] Not found:', { date, slot });
      return undefined;
    }
  }

  // Helper: get pharmacist name
  function getPharmacistName(pharmacistId: string) {
    const p = pharmacists.find((p: any) => p._id === pharmacistId);
    return p ? p.name : "";
  }

  // Helper: Get unavailable pharmacists for a given day
  function getUnavailablePharmacists(dateStr: string) {
    const date = new Date(dateStr);
    const dayLabel = DAYS[date.getDay()];
    return pharmacists.filter((p: any) => {
      if (!p.notAvailableRules || !Array.isArray(p.notAvailableRules)) return false;
      // If any rule matches this day
      return p.notAvailableRules.some((rule: any) => rule.dayOfWeek === dayLabel);
    });
  }

  // Helper: Get unavailable pharmacists for a given day
  function isPharmacistNotAvailable(pharmacist: any, dayLabel: string, slot: { start: string, end: string }) {
    return getAllUnavailableRules(pharmacist).some((rule: any) =>
      rule.dayOfWeek === dayLabel && !(slot.end <= rule.startTime || slot.start >= rule.endTime)
    );
  }

  // Helper: get all unavailable rules (permanent + rota-specific)
  function getAllUnavailableRules(pharmacist: any) {
    return [
      ...(pharmacist.notAvailableRules || []),
      ...(rotaUnavailableRules[pharmacist._id] || [])
    ];
  }

  // Helper to add a rota-specific unavailable rule
  function addRotaUnavailableRule(pharmacistId: string, rule: { dayOfWeek: string, startTime: string, endTime: string }) {
    setRotaUnavailableRules(prev => {
      const rules = prev[pharmacistId] || [];
      return { ...prev, [pharmacistId]: [...rules, rule] };
    });
  }
  // Helper to remove a rota-specific unavailable rule
  function removeRotaUnavailableRule(pharmacistId: string, idx: number) {
    setRotaUnavailableRules(prev => {
      const rules = (prev[pharmacistId] || []).slice();
      rules.splice(idx, 1);
      return { ...prev, [pharmacistId]: rules };
    });
  }

  // --- Add helper to determine pharmacist cell color ---
  function getPharmacistCellClass(pharmacistId: string) {
    const p = pharmacists.find((p: any) => p._id === pharmacistId);
    if (!p) return '';
    switch (p.band) {
      case 'Dispensary Pharmacist':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'EAU Practitioner':
        return 'bg-blue-900 text-white border-blue-900';
      case '8a':
        return 'bg-green-700 text-white';
      case '7':
        return 'bg-green-500 text-white';
      case '6':
        return 'bg-green-100 text-green-800';
      default:
        return '';
    }
  }

  // --- LOGGING: Pharmacist Working Days Initialization Effect ---
  useEffect(() => {
    if (!pharmacists || pharmacists.length === 0) return;
    console.log('[Effect] pharmacists changed:', pharmacists);
    // Only initialize if pharmacistWorkingDays is empty
    if (Object.keys(pharmacistWorkingDays).length === 0) {
      const newWorkingDays = Object.fromEntries(
        pharmacists.map((p: any) => [
          p._id,
          Array.isArray(p.workingDays) ? p.workingDays : CLINIC_DAY_LABELS,
        ])
      );
      const isDifferent =
        JSON.stringify(pharmacistWorkingDays) !== JSON.stringify(newWorkingDays);
      console.log('[Effect] pharmacistWorkingDays empty, isDifferent:', isDifferent);
      if (isDifferent) {
        console.log('[Effect] Setting pharmacistWorkingDays:', newWorkingDays);
        setPharmacistWorkingDays(newWorkingDays);
      }
    }
    // eslint-disable-next-line
  }, [pharmacists]);

  // --- LOGGING: Clinics Preselect Effect ---
  useEffect(() => {
    if (clinics.length > 0 && selectedClinicIds.length === 0) {
      // Pre-select all clinics with includeByDefaultInRota === true
      const defaultClinicIds = clinics.filter(c => c.includeByDefaultInRota).map(c => c._id);
      setSelectedClinicIds(defaultClinicIds);
    }
  }, [clinics, selectedClinicIds.length]);

  // --- LOGGING: Pharmacist Selection Effect ---
  useEffect(() => {
    if (!pharmacists || pharmacists.length === 0) return;
    console.log('[Effect] pharmacists changed (selection):', pharmacists);
    const defaultIds = pharmacists.filter((p: any) => p.isDefaultPharmacist).map((p: any) => p._id);
    setSelectedPharmacistIds((prev: Array<Id<"pharmacists">>) => {
      if (JSON.stringify(prev) !== JSON.stringify(defaultIds)) {
        return defaultIds;
      }
      return prev;
    });
  }, [pharmacists]);

  // --- LOGGING: RotaAssignments Setter ---
  function setRotaAssignmentsLogged(newAssignments: any[]) {
    console.log('[setRotaAssignments] called. New assignments:', newAssignments);
    setRotaAssignments((prev: any[]) => {
      const isDifferent = JSON.stringify(prev) !== JSON.stringify(newAssignments);
      console.log('[setRotaAssignments] prev:', prev, 'isDifferent:', isDifferent);
      return isDifferent ? newAssignments : prev;
    });
  }

  // --- LOGGING: Pharmacist Working Days Setter ---
  function setPharmacistWorkingDaysLogged(newWorkingDays: Record<string, string[]>) {
    console.log('[setPharmacistWorkingDays] called. New working days:', newWorkingDays);
    setPharmacistWorkingDays(newWorkingDays);
  }

  // --- LOGGING: handleSetPharmacistWorkingDays ---
  function handleSetPharmacistWorkingDays(pharmacistId: string, day: string, checked: boolean) {
    console.log('[handleSetPharmacistWorkingDays] pharmacistId:', pharmacistId, 'day:', day, 'checked:', checked);
    const newObj = { ...pharmacistWorkingDays };
    if (checked) {
      newObj[pharmacistId] = [...(newObj[pharmacistId] || []), day].filter((d, i, arr) => arr.indexOf(d) === i);
    } else {
      newObj[pharmacistId] = (newObj[pharmacistId] || []).filter(d => d !== day);
    }
    console.log('[handleSetPharmacistWorkingDays] result:', newObj);
    setPharmacistWorkingDaysLogged(newObj);
  }

  // --- LOGGING: RotaAssignments Population Effect ---
  useEffect(() => {
    console.log('[Effect] allRotas:', allRotas);
    console.log('[Effect] selectedMonday:', selectedMonday);
    if (!selectedMonday || !allRotas || allRotas.length === 0) return;
    console.log('[Effect] Populating rotaAssignments for week:', selectedMonday);
    // Fetch rotas for the week (Monday to Friday)
    const dates = Array.from({ length: 5 }, (v: undefined, i: number) => {
      const d = new Date(selectedMonday);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
    // Only use the most recent rota for each date
    const weekRotas = dates.map((date: string) => {
      // Find all rotas for this date
      const rotasForDate = allRotas.filter((r: any) => r.date === date);
      // Sort by generatedAt descending, pick the latest
      if (rotasForDate.length === 0) return null;
      return rotasForDate.sort((a: any, b: any) => b.generatedAt - a.generatedAt)[0];
    }).filter(Boolean);
    // Flatten assignments with date info
    const assignments = weekRotas.flatMap((r: any) => r.assignments.map((a: any) => ({ ...a, date: r.date })));
    console.log('[Effect] Setting rotaAssignments:', assignments);
    setRotaAssignmentsLogged(assignments);
  }, [selectedMonday, allRotas]);

  // --- LOGGING: Selected Monday and Rendered Dates ---
  useEffect(() => {
    if (!selectedMonday) return;
    const dates = Array.from({ length: 5 }, (v: undefined, i: number) => {
      const d = new Date(selectedMonday);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
    console.log('[RotaView] selectedMonday:', selectedMonday, 'Rendered dates:', dates);
  }, [selectedMonday]);

  // Reset singlePharmacistDispensaryDays when selectedMonday changes
  useEffect(() => {
    setSinglePharmacistDispensaryDays([]);
  }, [selectedMonday]);

  // Modified regeneration function to accept state override
  async function handleGenerateWeeklyRota(overrideSinglePharmacistDays?: string[], regenerateRota?: boolean) {
    // Prevent concurrent runs
    if (generatingWeekly) {
      console.warn('[handleGenerateWeeklyRota] Already generating, skipping concurrent call.');
      return;
    }
    if (!selectedMonday) return;

    setGeneratingWeekly(true); // Set generating flag BEFORE try block

    // Determine which state to use for the generation
    const daysToUse = overrideSinglePharmacistDays ?? singlePharmacistDispensaryDays;
    console.log('[handleGenerateWeeklyRota] Using singlePharmacistDays:', daysToUse);

    try {
      console.log(`[handleGenerateWeeklyRota] About to call Convex mutation with startDate: ${selectedMonday}, daysToUse: ${JSON.stringify(daysToUse)}`);
      await generateWeeklyRota({
        startDate: selectedMonday,
        pharmacistIds: selectedPharmacistIds,
        clinicIds: selectedClinicIds,
        pharmacistWorkingDays: pharmacistWorkingDays,
        singlePharmacistDispensaryDays: daysToUse, // Pass the determined state
        regenerateRota: regenerateRota, // Pass the regenerateRota flag
      });
      console.log(`[handleGenerateWeeklyRota] Convex mutation call finished for startDate: ${selectedMonday}`);
    } finally {
      setGeneratingWeekly(false);
      setRotaGenerated(true);
      console.log(`[handleGenerateWeeklyRota] finally block executed for startDate: ${selectedMonday}`);
    }
  }

  console.log('Rendering rotaAssignments', rotaAssignments);

  // Sort clinics by dayOfWeek and startTime for display
  const sortedSelectedClinics = clinics
    .filter((c: any) => selectedClinicIds.includes(c._id))
    .sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime));

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-4 mt-6">
        <div>
          <label className="block font-medium mb-1">Select Monday (week start)</label>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={selectedMonday}
            onChange={e => setSelectedMonday(e.target.value)}
            min="2024-01-01"
            step="7"
          />
        </div>
        <button
          className="bg-blue-600 text-white px-3 py-2 rounded mt-6 disabled:opacity-50"
          disabled={!selectedMonday || generatingWeekly}
          onClick={() => {
            setShowClinicSelection(true);
            setRotaGenerated(false);
          }}
        >
          Create Rota
        </button>
      </div>
      {showClinicSelection && !rotaGenerated && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Select Clinics to Include in Rota</h3>
          <div className="flex flex-wrap gap-4">
            {clinics.slice().sort((a: any, b: any) => (a.dayOfWeek - b.dayOfWeek) || a.startTime.localeCompare(b.startTime)).map((clinic: any) => (
              <label key={clinic._id} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={selectedClinicIds.includes(clinic._id)}
                  onChange={e => {
                    setSelectedClinicIds((ids: Array<Id<"clinics">>) =>
                      e.target.checked
                        ? [...ids, clinic._id]
                        : ids.filter(id => id !== clinic._id)
                    );
                  }}
                />
                <span>{clinic.name} ({CLINIC_DAY_LABELS[clinic.dayOfWeek-1]} {clinic.startTime}-{clinic.endTime})</span>
              </label>
            ))}
          </div>
          <button
            className="mt-4 bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedClinicIds.length === 0}
            onClick={() => {
              setShowClinicSelection(false);
              setShowPharmacistSelection(true);
            }}
          >
            Confirm Clinics
          </button>
        </div>
      )}
      {showPharmacistSelection && !rotaGenerated && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Select Pharmacists and Working Days</h3>
          <div className="flex flex-col gap-2">
            {[...pharmacists.filter((p: any) => p.isDefaultPharmacist),
              ...pharmacists.filter((p: any) =>
                !p.isDefaultPharmacist && selectedPharmacistIds.includes(p._id)
              ),
            ]
              .sort((a: any, b: any) => a.name.localeCompare(b.name))
              .map((pharmacist: any) => (
                <div key={pharmacist._id} className="border rounded p-2 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPharmacistIds.includes(pharmacist._id)}
                      onChange={e => {
                        setSelectedPharmacistIds((ids: Array<Id<"pharmacists">>) => {
                          const checked = e.target.checked;
                          if (checked && !ids.includes(pharmacist._id)) {
                            if (!pharmacistWorkingDays[pharmacist._id]) {
                              const newObj = { ...pharmacistWorkingDays };
                              newObj[pharmacist._id] = Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : CLINIC_DAY_LABELS;
                              setPharmacistWorkingDaysLogged(newObj);
                            }
                            return [...ids, pharmacist._id];
                          }
                          if (!checked) {
                            const newObj = { ...pharmacistWorkingDays };
                            delete newObj[pharmacist._id];
                            setPharmacistWorkingDaysLogged(newObj);
                            return ids.filter(id => id !== pharmacist._id);
                          }
                          return ids;
                        });
                      }}
                    />
                    <span className="font-medium">{pharmacist.name}</span>
                    {pharmacist.isDefaultPharmacist && (
                      <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Default</span>
                    )}
                  </div>
                  {selectedPharmacistIds.includes(pharmacist._id) && (
                    <div className="flex flex-wrap gap-4 mt-2 md:mt-0 items-center">
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-xs whitespace-nowrap mr-1">Working Days:</span>
                        {CLINIC_DAY_LABELS.map((day: string) => (
                          <label key={day} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={pharmacistWorkingDays[pharmacist._id]?.includes(day) || false}
                              onChange={e => {
                                handleSetPharmacistWorkingDays(pharmacist._id, day, e.target.checked);
                              }}
                            />
                            <span className="text-xs">{day}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="font-semibold text-xs whitespace-nowrap">Protected Rota Time:</span>
                        <ul className="flex gap-2 mb-0">
                          {getAllUnavailableRules(pharmacist).map((rule, idx) => (
                            <li key={idx} className="flex items-center gap-1 text-xs bg-red-50 rounded px-1">
                              <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                              <button
                                type="button"
                                className="text-red-500 text-xs ml-1"
                                onClick={() => {
                                  if (idx < (pharmacist.notAvailableRules?.length || 0)) {
                                    const updated = [...(pharmacist.notAvailableRules || [])];
                                    updated.splice(idx, 1);
                                    setRotaUnavailableRules(prev => ({
                                      ...prev,
                                      [pharmacist._id]: [
                                        ...((prev[pharmacist._id] || [])),
                                        ...updated.filter((_, i) => i !== idx)
                                      ]
                                    }));
                                    pharmacist.notAvailableRules.splice(idx, 1);
                                  } else {
                                    removeRotaUnavailableRule(pharmacist._id, idx - (pharmacist.notAvailableRules?.length || 0));
                                  }
                                }}
                              >✕</button>
                            </li>
                          ))}
                        </ul>
                        <select className="border rounded text-xs" id={`unavail-day-${pharmacist._id}`}>{CLINIC_DAY_LABELS.map(day => <option key={day} value={day}>{day}</option>)}</select>
                        <input className="border rounded text-xs w-20" id={`unavail-start-${pharmacist._id}`} type="time" defaultValue="09:00" />
                        <input className="border rounded text-xs w-20" id={`unavail-end-${pharmacist._id}`} type="time" defaultValue="17:00" />
                        <button type="button" className="text-blue-600 text-xs border px-1 rounded" onClick={() => {
                          const day = (document.getElementById(`unavail-day-${pharmacist._id}`) as HTMLSelectElement).value;
                          const start = (document.getElementById(`unavail-start-${pharmacist._id}`) as HTMLInputElement).value;
                          const end = (document.getElementById(`unavail-end-${pharmacist._id}`) as HTMLInputElement).value;
                          addRotaUnavailableRule(pharmacist._id, { dayOfWeek: day, startTime: start, endTime: end });
                        }}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            {/* Pharmacist search bar for non-defaults */}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search non-default pharmacists..."
                className="border rounded px-2 py-1 w-64"
                value={pharmacistSearch}
                onChange={e => setPharmacistSearch(e.target.value)}
              />
            </div>
            {/* Non-default pharmacists, only show if search is active and not selected */}
            {pharmacistSearch && ([...pharmacists]
              .filter((p: any) => !p.isDefaultPharmacist &&
                !selectedPharmacistIds.includes(p._id) &&
                p.name.toLowerCase().includes(pharmacistSearch.toLowerCase())
              )
              .sort((a: any, b: any) => a.name.localeCompare(b.name))
              .map((pharmacist: any) => (
                <div key={pharmacist._id} className="border rounded p-2 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPharmacistIds.includes(pharmacist._id)}
                      onChange={e => {
                        setSelectedPharmacistIds((ids: Array<Id<"pharmacists">>) => {
                          const checked = e.target.checked;
                          if (checked && !ids.includes(pharmacist._id)) {
                            if (!pharmacistWorkingDays[pharmacist._id]) {
                              const newObj = { ...pharmacistWorkingDays };
                              newObj[pharmacist._id] = Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : CLINIC_DAY_LABELS;
                              setPharmacistWorkingDaysLogged(newObj);
                            }
                            return [...ids, pharmacist._id];
                          }
                          if (!checked) {
                            const newObj = { ...pharmacistWorkingDays };
                            delete newObj[pharmacist._id];
                            setPharmacistWorkingDaysLogged(newObj);
                            return ids.filter(id => id !== pharmacist._id);
                          }
                          return ids;
                        });
                      }}
                    />
                    <span className="font-medium">{pharmacist.name}</span>
                  </div>
                  {selectedPharmacistIds.includes(pharmacist._id) && (
                    <div className="flex flex-wrap gap-4 mt-2 md:mt-0 items-center">
                      <div className="flex gap-2 items-center">
                        <span className="font-semibold text-xs whitespace-nowrap mr-1">Working Days:</span>
                        {CLINIC_DAY_LABELS.map((day: string) => (
                          <label key={day} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={pharmacistWorkingDays[pharmacist._id]?.includes(day) || false}
                              onChange={e => {
                                handleSetPharmacistWorkingDays(pharmacist._id, day, e.target.checked);
                              }}
                            />
                            <span className="text-xs">{day}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="font-semibold text-xs whitespace-nowrap">Protected Rota Time:</span>
                        <ul className="flex gap-2 mb-0">
                          {getAllUnavailableRules(pharmacist).map((rule, idx) => (
                            <li key={idx} className="flex items-center gap-1 text-xs bg-red-50 rounded px-1">
                              <span>{rule.dayOfWeek} {rule.startTime}-{rule.endTime}</span>
                              <button
                                type="button"
                                className="text-red-500 text-xs ml-1"
                                onClick={() => {
                                  if (idx < (pharmacist.notAvailableRules?.length || 0)) {
                                    const updated = [...(pharmacist.notAvailableRules || [])];
                                    updated.splice(idx, 1);
                                    setRotaUnavailableRules(prev => ({
                                      ...prev,
                                      [pharmacist._id]: [
                                        ...((prev[pharmacist._id] || [])),
                                        ...updated.filter((_, i) => i !== idx)
                                      ]
                                    }));
                                    pharmacist.notAvailableRules.splice(idx, 1);
                                  } else {
                                    removeRotaUnavailableRule(pharmacist._id, idx - (pharmacist.notAvailableRules?.length || 0));
                                  }
                                }}
                              >✕</button>
                            </li>
                          ))}
                        </ul>
                        <select className="border rounded text-xs" id={`unavail-day-${pharmacist._id}`}>{CLINIC_DAY_LABELS.map(day => <option key={day} value={day}>{day}</option>)}</select>
                        <input className="border rounded text-xs w-20" id={`unavail-start-${pharmacist._id}`} type="time" defaultValue="09:00" />
                        <input className="border rounded text-xs w-20" id={`unavail-end-${pharmacist._id}`} type="time" defaultValue="17:00" />
                        <button type="button" className="text-blue-600 text-xs border px-1 rounded" onClick={() => {
                          const day = (document.getElementById(`unavail-day-${pharmacist._id}`) as HTMLSelectElement).value;
                          const start = (document.getElementById(`unavail-start-${pharmacist._id}`) as HTMLInputElement).value;
                          const end = (document.getElementById(`unavail-end-${pharmacist._id}`) as HTMLInputElement).value;
                          addRotaUnavailableRule(pharmacist._id, { dayOfWeek: day, startTime: start, endTime: end });
                        }}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              )))
            }
          </div>
          <button
            className="mt-4 bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
            disabled={selectedPharmacistIds.length === 0}
            onClick={() => {
              setShowPharmacistSelection(false);
              handleGenerateWeeklyRota();
            }}
          >
            Confirm Pharmacists
          </button>
        </div>
      )}
      {rotaGenerated && (
        <div className="mt-10">
          <h3 className="text-xl font-bold mb-4">Weekly Rota Table</h3>
          
          {/* Dispensary Mode Toggles */}
          <div className="mb-4">
            {[0,1,2,3,4].map((dayOffset: number) => {
              const date = new Date(selectedMonday);
              date.setDate(date.getDate() + dayOffset);
              const isoDate = date.toISOString().split('T')[0];
              
              // Check if this day has a dispensary pharmacist
              const hasDispensaryPharmacist = pharmacists.some(p => {
                return p.band === "Dispensary Pharmacist" && 
                       selectedPharmacistIds.includes(p._id) && // Only consider selected pharmacists
                       // Check if they work on this day (either no working days specified or this day is included)
                       (pharmacistWorkingDays[p._id]?.includes(DAYS[date.getDay()]) || 
                          (!pharmacistWorkingDays[p._id] && p.workingDays?.includes(DAYS[date.getDay()]))) &&
                       // And they don't have unavailable rules that conflict with the whole day
                       (!getAllUnavailableRules(p).some(rule => 
                          rule.dayOfWeek === DAYS[date.getDay()] &&
                          !(rule.endTime <= "09:00" || rule.startTime >= "17:00")
                       ));
              });
              
              // Only show toggle for days without dispensary pharmacist
              if (!hasDispensaryPharmacist) {
                return (
                  <div key={isoDate} className="flex items-center gap-2 mb-2">
                    <label className="flex items-center cursor-pointer">
                      <div className="mr-2 text-sm font-medium">
                        {DAYS[date.getDay()]} ({date.toLocaleDateString()}): 
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={singlePharmacistDispensaryDays.includes(isoDate)}
                          onChange={e => {
                            const isChecked = e.target.checked;
                            let nextState: string[];
                            // Calculate the next state *before* setting it
                            if (isChecked) {
                               nextState = [...singlePharmacistDispensaryDays, isoDate];
                            } else {
                               nextState = singlePharmacistDispensaryDays.filter(d => d !== isoDate);
                            }
                            // Set the state
                            setSinglePharmacistDispensaryDays(nextState);
                            // Immediately call regeneration with the calculated next state
                            handleGenerateWeeklyRota(nextState, true);
                          }}
                        />
                        <div className={`w-10 h-5 bg-gray-200 rounded-full shadow-inner transition-colors ${singlePharmacistDispensaryDays.includes(isoDate) ? 'bg-blue-500' : ''}`}></div>
                        <div className={`absolute w-4 h-4 bg-white rounded-full shadow top-0.5 left-0.5 transition ${singlePharmacistDispensaryDays.includes(isoDate) ? 'transform translate-x-5' : ''}`}></div>
                      </div>
                      <div className="ml-2 text-sm text-gray-700">
                        {singlePharmacistDispensaryDays.includes(isoDate) 
                          ? "Single pharmacist all day" 
                          : "Multiple pharmacists (2-hour slots)"}
                      </div>
                    </label>
                  </div>
                );
              }
              return null;
            })}
          </div>
          
          <div className="overflow-x-auto w-full max-w-full">
            <table className="border text-xs md:text-sm table-fixed w-full">
              <colgroup>
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                {[...Array(5 * TIME_SLOTS.length)].map((_, idx) => (
                  <col key={idx} style={{ width: '70px' }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="border p-2 bg-gray-100 sticky left-0 z-10 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>Directorate</th>
                  <th className="border p-2 bg-gray-100 sticky left-0 z-10 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>Ward</th>
                  {[0,1,2,3,4].map((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    return (
                      <th key={dayOffset} colSpan={TIME_SLOTS.length} className="border p-2 bg-gray-100 text-xs border-r-4 border-gray-400 border-b border-gray-200" style={{ borderBottomWidth: 1 }}>
                        {DAYS[date.getDay()]}<br/>{date.toLocaleDateString()}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="border p-2 sticky left-0 bg-white z-10 border-b border-gray-200" colSpan={2} style={{ borderBottomWidth: 1 }}></th>
                  {[...Array(5)].flatMap((_, dayIdx: number) =>
                    TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => (
                      <th key={dayIdx + '-' + slot.start + '-' + slot.end}
                        className={`border p-2 bg-blue-50 text-xs${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`}
                        style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}
                      >
                        {slot.start}-{slot.end}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {allWards.flatMap((ward: any, idx: number) => {
                  if (ward.directorate === "EAU") {
                    const todayDates = [...Array(5)].map((_, dayOffset) => {
                      const d = new Date(selectedMonday);
                      d.setDate(d.getDate() + dayOffset);
                      return d.toISOString().split('T')[0];
                    });
                    let maxRows = 0;
                    todayDates.forEach(date => {
                      TIME_SLOTS.forEach(slot => {
                        const list = rotaAssignments.filter(a =>
                          a.type === "ward" &&
                          a.date === date &&
                          a.location === ward.name &&
                          a.startTime <= slot.start &&
                          a.endTime >= slot.end
                        );
                        if (list.length > maxRows) maxRows = list.length;
                      });
                    });
                    return Array.from({ length: maxRows }, (_, rowIdx) => (
                      <tr key={`${ward.name}_row_${rowIdx}`} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                        <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{rowIdx === 0 ? ward.directorate : ''}</td>
                        <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{rowIdx === 0 ? ward.name : ''}</td>
                        {todayDates.flatMap((isoDate, dayOffset) =>
                          TIME_SLOTS.map((slot, slotIdx) => {
                            const list = rotaAssignments.filter(a =>
                              a.type === "ward" &&
                              a.date === isoDate &&
                              a.location === ward.name &&
                              a.startTime <= slot.start &&
                              a.endTime >= slot.end
                            );
                            const a = list[rowIdx];
                            return (
                              <td key={`${isoDate}${slot.start}${slot.end}${ward.name}${rowIdx}`}
                                className={`border p-1 text-center truncate max-w-[70px] text-xs align-middle whitespace-normal${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${a ? getPharmacistCellClass(a.pharmacistId) : ''}`}
                                style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}
                              >
                                {a ? getPharmacistName(a.pharmacistId) : ''}
                              </td>
                            );
                          })
                        )}
                      </tr>
                    ));
                  }
                  return [
                    <tr key={ward.directorate + ward.name} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                      <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{ward.directorate}</td>
                      <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{ward.name}</td>
                      {[...Array(5)].flatMap((_, dayOffset: number) => {
                        const date = new Date(selectedMonday);
                        date.setDate(date.getDate() + dayOffset);
                        const isoDate = date.toISOString().split('T')[0];
                        return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                          const assignment = getWardAssignment(isoDate, ward.name, slot);
                          return (
                            <td key={isoDate + slot.start + slot.end + ward.name}
                              className={`border p-1 text-center truncate max-w-[70px] text-xs${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${assignment ? getPharmacistCellClass(assignment.pharmacistId) : ''}`}
                              style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}
                            >
                              {assignment ? getPharmacistName(assignment.pharmacistId) : ''}
                            </td>
                          );
                        });
                      })}
                    </tr>
                  ];
                })}
                <tr>
                  <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" colSpan={2} style={{ borderBottom: '1px solid #e5e7eb' }}>Dispensary</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                      const assignment = getDispensaryAssignment(isoDate, slot);
                      let displayName = '';
                      let isLunch = false;
                      if (assignment) {
                        displayName = getPharmacistName(assignment.pharmacistId);
                        if (assignment.isLunchCover && slot.start === '13:00' && slot.end === '15:00') {
                          isLunch = true;
                        }
                      }
                      return (
                        <td
                          key={isoDate + slot.start + slot.end + 'dispensary'}
                          className={`border p-1 text-center max-w-[70px] text-xs bg-gray-50${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${displayName ? getPharmacistCellClass(assignment?.pharmacistId) : ''}`}
                          style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                        >
                          {displayName && (
                            isLunch ? (
                              <span>
                                {displayName}
                                <br />
                                <span style={{ fontWeight: 400 }}>(Lunch)</span>
                              </span>
                            ) : (
                              displayName
                            )
                          )}
                        </td>
                      );
                    });
                  })}
                </tr>
                {sortedSelectedClinics.map((clinic: any, idx: number) => {
                  // Highlight all slots that overlap with the clinic's time range
                  // Add '(Warfarin Clinic)' after the clinic code in the far left column
                  const clinicLabel = `${clinic.name} (Warfarin Clinic)`;
                  return (
                    <tr key={clinic._id}>
                      <td className="border p-2 font-semibold sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{clinicLabel}</td>
                      <td className="border p-2 sticky left-0 bg-white z-10 truncate max-w-[120px]" style={{ borderBottom: '1px solid #e5e7eb' }}>{clinic.name}</td>
                      {[...Array(5)].flatMap((_, dayOffset: number) => {
                        const date = new Date(selectedMonday);
                        date.setDate(date.getDate() + dayOffset);
                        const isoDate = date.toISOString().split('T')[0];
                        return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                          const isClinicDay = (dayOffset + 1) === clinic.dayOfWeek;
                          // Highlight if slot overlaps with clinic time (inclusive start, exclusive end)
                          const slotStart = slot.start;
                          const slotEnd = slot.end;
                          const overlaps =
                            slotStart < clinic.endTime && slotEnd > clinic.startTime;
                          if (isClinicDay && overlaps) {
                            // Get clinic assignment for this date
                            const assignment = getClinicAssignment(isoDate, clinic.name);
                            return (
                              <td
                                key={isoDate + slot.start + slot.end + clinic._id}
                                className={`border p-1 text-center truncate max-w-[70px] text-xs bg-yellow-50 font-semibold${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''} ${assignment ? getPharmacistCellClass(assignment.pharmacistId) : ''}`}
                                style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}
                              >
                                {assignment ? getPharmacistName(assignment.pharmacistId) : ""}
                              </td>
                            );
                          } else {
                            return <td key={isoDate + slot.start + slot.end + clinic._id} className={`border p-1 text-center max-w-[70px] text-xs bg-gray-50${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`} style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}></td>;
                          }
                        });
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {/* --- Unavailable Pharmacists Row --- */}
              <tfoot>
                <tr>
                  <td colSpan={2} className="border p-2 font-semibold bg-red-50 text-red-700 sticky left-0 z-10" style={{ borderBottom: '1px solid #e5e7eb' }}>Unavailable</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    // For this day, get unavailable pharmacists for each slot
                    return TIME_SLOTS.map((slot, slotIdx) => {
                      // For this slot, get pharmacists unavailable at this day/slot
                      const unavailable = pharmacists.filter((p: any) => {
                        if (!p.notAvailableRules || !Array.isArray(p.notAvailableRules)) return false;
                        return p.notAvailableRules.some((rule: any) =>
                          rule.dayOfWeek === DAYS[date.getDay()] &&
                          !(rule.endTime <= slot.start || rule.startTime >= slot.end)
                        );
                      });
                      return (
                        <td key={dayOffset + '-' + slotIdx} className="border p-1 text-xs bg-red-50 text-red-700 text-center" style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined }}>
                          {unavailable.map((p: any) => p.name).join(', ') || ''}
                        </td>
                      );
                    });
                  })}
                </tr>
                {/* --- Management Time --- */}
                <tr>
                  <td className="border p-2 font-semibold sticky left-0 bg-blue-100 z-10 truncate max-w-[120px]" colSpan={2} style={{ borderBottom: '1px solid #e5e7eb' }}>Management Time</td>
                  {[0,1,2,3,4].flatMap((dayOffset: number) => {
                    const date = new Date(selectedMonday);
                    date.setDate(date.getDate() + dayOffset);
                    const isoDate = date.toISOString().split('T')[0];
                    return TIME_SLOTS.map((slot: { start: string; end: string }, slotIdx: number) => {
                      // Find Band 8a pharmacists in Management Time for this date/slot
                      const managementAssignments = rotaAssignments.filter(a => 
                        a.type === "management" && 
                        a.date === isoDate && 
                        ((a.startTime <= slot.start && a.endTime > slot.start) || 
                         (a.startTime < slot.end && a.endTime >= slot.end) ||
                         (a.startTime >= slot.start && a.endTime <= slot.end))
                      );
                      
                      // Get pharmacist names
                      const pharmacistNames = managementAssignments.map(a => getPharmacistName(a.pharmacistId)).filter(Boolean);
                      
                      return (
                        <td
                          key={isoDate + slot.start + slot.end + 'management'}
                          className={`border p-1 text-center max-w-[70px] text-xs bg-blue-50${slotIdx === TIME_SLOTS.length - 1 ? ' border-r-4 border-gray-400' : ''}`} 
                          style={{ borderBottom: '1px solid #e5e7eb', borderRight: slotIdx === TIME_SLOTS.length - 1 ? '4px solid #9ca3af' : undefined, height: '2.5em', minHeight: '2.5em', lineHeight: '1.2', whiteSpace: 'normal', wordBreak: 'break-word' }}
                        >
                          {pharmacistNames.length > 0 ? (
                            <span>{pharmacistNames.join(", ")}</span>
                          ) : null}
                        </td>
                      );
                    });
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
