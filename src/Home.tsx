import { useState } from "react";
import { PharmacistList } from "./PharmacistList";
import { RequirementsList } from "./RequirementsList";
import { ClinicList } from "./ClinicList";
import { RotaView } from "./RotaView";

export default function Home() {
  const [view, setView] = useState<"pharmacists" | "requirements" | "rota" | null>(null);

  return (
    <main className="container mx-auto p-4">
      <div className="min-h-screen">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Pharmacy Rota Management</h1>
        </div>

        <div className="flex flex-col gap-8 items-center">
          <div className="flex gap-6 mb-8">
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-blue-600 text-white hover:bg-blue-700 ${view === "pharmacists" ? "ring-4 ring-blue-300" : ""}`}
              onClick={() => setView("pharmacists")}
            >
              Manage Pharmacists
            </button>
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-green-600 text-white hover:bg-green-700 ${view === "requirements" ? "ring-4 ring-green-300" : ""}`}
              onClick={() => setView("requirements")}
            >
              Update Rota Requirements
            </button>
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 ${view === "rota" ? "ring-4 ring-purple-300" : ""}`}
              onClick={() => setView("rota")}
            >
              Create Rota
            </button>
          </div>

          {view === "pharmacists" && <PharmacistList />}
          {view === "requirements" && (
            <div className="flex flex-col gap-8 w-full">
              <ClinicList />
              <RequirementsList />
            </div>
          )}
          {view === "rota" && <RotaView />}

          {!view && (
            <div className="text-gray-600 text-lg mt-10">
              Select an option above to get started.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
