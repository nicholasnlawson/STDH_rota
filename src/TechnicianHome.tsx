import { useState } from "react";
import { TechnicianList } from "./TechnicianList";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Doc } from "../convex/_generated/dataModel";
import { TechnicianPublishedRotasList } from "./TechnicianPublishedRotasList";
import { TechnicianRequirementsList } from "./TechnicianRequirementsList";
import { TechnicianRotaView } from "./TechnicianRotaView";

interface TechnicianHomeProps {
  isAdmin: boolean;
  userEmail: string;
}

export function TechnicianHome({ isAdmin, userEmail }: TechnicianHomeProps) {
  const [view, setView] = useState<"technicians" | "requirements" | "rota" | "profile" | "publishedRotas" | null>(null);
  const technicians = useQuery(api.technicians.list) || [];
  const currentTechnician = technicians.find((t: Doc<"technicians">) => t.email === userEmail);
  
  return (
    <main className="container mx-auto p-4">
      <div className="min-h-screen">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Pharmacy Technician Rota Management</h1>
        </div>

        <div className="flex flex-col gap-8 items-center">
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {/* Show Manage Technicians button only to admins */}
            {isAdmin && (
              <button
                className={`px-6 py-4 rounded shadow text-lg font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors ${view === "technicians" ? "ring-4 ring-blue-300" : ""}`}
                onClick={() => setView("technicians")}
              >
                Manage Technicians
              </button>
            )}
            {/* Requirements can only be updated by administrators */}
            {isAdmin && (
              <button
                className={`px-6 py-4 rounded shadow text-lg font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors ${view === "requirements" ? "ring-4 ring-green-300" : ""}`}
                onClick={() => setView("requirements")}
              >
                Update Rota Requirements
              </button>
            )}
            {/* Only admins can access the Create Rota feature */}
            {isAdmin && (
              <button
                className={`px-6 py-4 rounded shadow text-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors ${view === "rota" ? "ring-4 ring-purple-300" : ""}`}
                onClick={() => setView("rota")}
              >
                Create Rota
              </button>
            )}
            {/* View Published Rotas button for all users */}
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-yellow-500 text-white hover:bg-yellow-600 transition-colors ${view === "publishedRotas" ? "ring-4 ring-yellow-300" : ""}`}
              onClick={() => setView("publishedRotas")}
            >
              View Published Rotas
            </button>
            {/* My Profile button for all users */}
            <button
              className={`px-6 py-4 rounded shadow text-lg font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors ${view === "profile" ? "ring-4 ring-teal-300" : ""}`}
              onClick={() => setView("profile")}
            >
              My Profile
            </button>
          </div>
          
          {!view && (
            <div className="text-gray-600 text-lg mt-10">
              Select an option above to get started.
            </div>
          )}
        </div>

        <div className="w-full">
          {view === "technicians" && (
            <TechnicianList isAdmin={isAdmin} userEmail={userEmail} />
          )}
          {view === "requirements" && isAdmin && <TechnicianRequirementsList />}
          {view === "rota" && isAdmin && (
            <TechnicianRotaView isAdmin={isAdmin} />
          )}
          {view === "publishedRotas" && <TechnicianPublishedRotasList isAdmin={isAdmin} />}
          {view === "profile" && currentTechnician && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-semibold mb-4">My Profile</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Name:</h3>
                  <p>{currentTechnician.name}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Email:</h3>
                  <p>{currentTechnician.email}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Band:</h3>
                  <p>{currentTechnician.band}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Primary Wards:</h3>
                  <ul className="list-disc pl-5">
                    {currentTechnician.primaryWards?.length ? (
                      currentTechnician.primaryWards.map((ward, index) => (
                        <li key={index}>{ward}</li>
                      ))
                    ) : (
                      <li>No primary wards assigned</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold">Specialist Training:</h3>
                  <ul className="list-disc pl-5">
                    {currentTechnician.specialistTraining?.length ? (
                      currentTechnician.specialistTraining.map((training, index) => (
                        <li key={index}>{training}</li>
                      ))
                    ) : (
                      <li>No specialist training listed</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold">Certifications:</h3>
                  <ul className="list-disc pl-5">
                    {currentTechnician.isAccuracyChecker && <li>Accuracy Checker</li>}
                    {currentTechnician.isMedsRecTrained && <li>Medication Reconciliation Trained</li>}
                    {!currentTechnician.isAccuracyChecker && !currentTechnician.isMedsRecTrained && (
                      <li>No certifications listed</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
