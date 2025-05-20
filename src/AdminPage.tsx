import { useState } from "react";
import { AdminRotaManagement } from "./AdminRotaManagement";
import { AdminPasswordReset } from "./AdminPasswordReset";

type AdminTab = 'rota-management' | 'password-reset';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('rota-management');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Controls</h1>
      
      {/* Tab Navigation */}
      <div className="flex space-x-4 border-b mb-6">
        <button
          onClick={() => setActiveTab('rota-management')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'rota-management'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Rota Management
        </button>
        <button
          onClick={() => setActiveTab('password-reset')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'password-reset'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Password Reset
        </button>
      </div>

      {/* Tab Content */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        {activeTab === 'rota-management' && <AdminRotaManagement />}
        {activeTab === 'password-reset' && <AdminPasswordReset />}
      </div>
    </div>
  );
}
