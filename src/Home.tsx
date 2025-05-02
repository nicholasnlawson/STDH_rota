import { useState } from "react";
import { PharmacistList } from "./PharmacistList";
import { RequirementsList } from "./RequirementsList";
import { ClinicList } from "./ClinicList";
import { RotaView } from "./RotaView";
import { PublishedRotasList } from "./PublishedRotasList";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { UserProfile } from "./UserProfile";

interface HomeProps {
  isAdmin: boolean;
  userEmail: string;
}

export default function Home({ isAdmin, userEmail }: HomeProps) {
  const [view, setView] = useState<"pharmacists" | "requirements" | "rota" | "profile" | "publishedRotas" | null>(null);
  const pharmacists = useQuery(api.pharmacists.list) || [];
  const currentPharmacist = pharmacists.find(p => p.email === userEmail);

  return (
    <main className="container mx-auto p-4">
      <div className="min-h-screen">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Pharmacy Rota Management</h1>
        </div>

        <div className="flex flex-col gap-8 items-center">
          <div className="flex gap-6 mb-8">
            {/* Show Manage Pharmacists button only to admins */}
            {isAdmin && (
              <button
                className={`px-6 py-4 rounded shadow text-lg font-semibold bg-blue-600 text-white hover:bg-blue-700 ${view === "pharmacists" ? "ring-4 ring-blue-300" : ""}`}
                onClick={() => setView("pharmacists")}
              >
                Manage Pharmacists
              </button>
            )}
            {/* Requirements can only be updated by administrators */}
            {isAdmin && (
              <button
                className={`px-6 py-4 rounded shadow text-lg font-semibold bg-green-600 text-white hover:bg-green-700 ${view === "requirements" ? "ring-4 ring-green-300" : ""}`}
                onClick={() => setView("requirements")}
              >
                Update Rota Requirements
              </button>
            )}
            {/* Everyone can access the Create Rota feature */}
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 ${view === "rota" ? "ring-4 ring-purple-300" : ""}`}
              onClick={() => setView("rota")}
            >
              Create Rota
            </button>
            {/* View Published Rotas button for all users */}
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-yellow-500 text-white hover:bg-yellow-600 ${view === "publishedRotas" ? "ring-4 ring-yellow-300" : ""}`}
              onClick={() => setView("publishedRotas")}
            >
              View Published Rotas
            </button>
            {/* My Profile button for all users */}
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-teal-600 text-white hover:bg-teal-700 ${view === "profile" ? "ring-4 ring-teal-300" : ""}`}
              onClick={() => setView("profile")}
            >
              My Profile
            </button>
          </div>

          {view === "pharmacists" && isAdmin && <PharmacistList />}
          {view === "requirements" && isAdmin && (
            <div className="flex flex-col gap-8 w-full">
              <ClinicList />
              <RequirementsList />
            </div>
          )}
          {view === "rota" && <RotaView />}
          {view === "publishedRotas" && <PublishedRotasList isAdmin={isAdmin} />}
          {view === "profile" && currentPharmacist && (
            <UserProfile pharmacist={{
              ...currentPharmacist,
              workingDays: currentPharmacist.workingDays ?? [],
            }} />
          )}

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
