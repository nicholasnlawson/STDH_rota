import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";
import { AdminRotaManagement } from "./AdminRotaManagement";

export function AdminPage() {
  const runMigration = useMutation(api.migratePharmacists.removeFirstLastName);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'migrations' | 'rota-management'>('migrations');

  const handleMigration = async () => {
    setIsLoading(true);
    try {
      const result = await runMigration();
      setMigrationStatus(`Migration completed successfully. Updated ${result.migrated} pharmacist records.`);
    } catch (error) {
      setMigrationStatus(`Error during migration: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Controls</h1>
      
      {/* Tab Navigation */}
      <div className="flex border-b mb-6">
        <button
          className={`px-4 py-2 font-medium ${activeTab === 'migrations' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('migrations')}
        >
          Database Migrations
        </button>
        <button
          className={`px-4 py-2 font-medium ${activeTab === 'rota-management' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('rota-management')}
        >
          Rota Management
        </button>
      </div>

      {/* Migrations Tab */}
      {activeTab === 'migrations' && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Database Migrations</h2>
          <div className="mb-4">
            <h3 className="font-medium mb-2">Pharmacist Data Migration</h3>
            <p className="text-gray-600 mb-4">
              This migration removes the deprecated firstName and lastName fields from pharmacist records,
              keeping only the consolidated name and displayName fields.
            </p>
            <button
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow-sm disabled:opacity-50"
              onClick={handleMigration}
              disabled={isLoading}
            >
              {isLoading ? "Running Migration..." : "Run Migration"}
            </button>
          </div>
          
          {migrationStatus && (
            <div className={`mt-4 p-3 rounded ${migrationStatus.includes("Error") ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
              {migrationStatus}
            </div>
          )}
        </div>
      )}

      {/* Rota Management Tab */}
      {activeTab === 'rota-management' && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <AdminRotaManagement />
        </div>
      )}
    </div>
  );
}
