import React, { useState } from 'react';
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

// Format date helper function
function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  return date.toLocaleDateString('en-GB', { 
    weekday: 'short',
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
}

export function AdminRotaManagement() {
  const [showModal, setShowModal] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState<string>('');
  const [beforeDate, setBeforeDate] = useState<string>('');
  const [operationResult, setOperationResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'week' | 'before'>('week');
  const [rotaType, setRotaType] = useState<'pharmacist' | 'technician'>('pharmacist');

  // Get all archived rotas to display statistics
  const archivedRotas = useQuery(
    rotaType === 'pharmacist' ? api.rotas.listRotas : api.technicianRotas.listRotas, 
    { status: "archived" }
  ) || [];
  
  const deleteArchivedRotas = useMutation(
    rotaType === 'pharmacist' ? api.rotas.deleteArchivedRotas : api.technicianRotas.deleteArchivedRotas
  );

  // Group archived rotas by week
  const rotasByWeek = (archivedRotas || []).reduce((acc: Record<string, any[]>, rota: any) => {
    // Get Monday of the week for this rota
    const date = new Date(rota.date);
    const day = date.getDay(); // 0 is Sunday, 1 is Monday
    const diff = day === 0 ? -6 : 1 - day; // Adjust to get to Monday
    const monday = new Date(date);
    monday.setDate(date.getDate() + diff);
    const mondayStr = monday.toISOString().split('T')[0];
    
    if (!acc[mondayStr]) {
      acc[mondayStr] = [];
    }
    acc[mondayStr].push(rota);
    return acc;
  }, {});

  const handleDelete = async () => {
    setLoading(true);
    setOperationResult(null);

    try {
      // Use the correct confirmation code based on rota type
      const confirmationCode = rotaType === 'pharmacist' 
        ? 'CONFIRM_DELETE_ARCHIVED_ROTAS'  // For pharmacist rotas (uppercase with underscores)
        : 'confirm-delete-archived-rotas'; // For technician rotas (lowercase with hyphens)
        
      const result = await deleteArchivedRotas({
        weekStartDate: selectedOption === 'week' ? weekStartDate : undefined,
        beforeDate: selectedOption === 'before' ? beforeDate : undefined,
        adminConfirmation: confirmationCode
      });
      
      setOperationResult({ 
        success: true, 
        message: result.message || `Successfully deleted archived rotas`,
        details: result
      });
      
      // Reset form
      setWeekStartDate('');
      setBeforeDate('');
      setShowModal(false);
    } catch (error) {
      console.error('Error deleting rotas:', error);
      setOperationResult({ 
        success: false, 
        message: 'Error deleting rotas',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Admin Rota Management</h2>
      
      {/* Rota Type Toggle */}
      <div className="flex mb-6 border-b">
        <button
          className={`px-4 py-2 ${rotaType === 'pharmacist' ? 'bg-blue-100 border-b-2 border-blue-600' : ''}`}
          onClick={() => setRotaType('pharmacist')}
        >
          Pharmacist Rotas
        </button>
        <button
          className={`px-4 py-2 ${rotaType === 'technician' ? 'bg-blue-100 border-b-2 border-blue-600' : ''}`}
          onClick={() => setRotaType('technician')}
        >
          Technician Rotas
        </button>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h3 className="text-lg font-semibold mb-4">Archived Rotas Statistics</h3>
        <p className="text-sm text-gray-700 mb-2">Total archived rotas: <span className="font-bold">{archivedRotas.length}</span></p>
        
        <div className="mt-4">
          <h4 className="font-medium mb-2">Rotas by Week:</h4>
          <ul className="space-y-2">
            {Object.entries(rotasByWeek).map(([weekStart, rotas]) => (
              <li key={weekStart} className="flex justify-between text-sm">
                <span>{formatDate(weekStart)}</span>
                <span className="font-medium">{(rotas as any[]).length} rotas</span>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="mt-6">
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Delete Archived Rotas
          </button>
        </div>
      </div>
      
      {/* Delete Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Delete Archived {rotaType === 'pharmacist' ? 'Pharmacist' : 'Technician'} Rotas</h3>
            <p className="text-red-600 font-medium mb-4">Warning: This action cannot be undone.</p>
            
            <div className="mb-4">
              <div className="mb-4">
                <label className="block mb-2">
                  <input
                    type="radio"
                    className="mr-2"
                    checked={selectedOption === 'week'}
                    onChange={() => setSelectedOption('week')}
                  />
                  By Week Start Date
                </label>
                <label className="block mb-2">
                  <input
                    type="radio"
                    className="mr-2"
                    checked={selectedOption === 'before'}
                    onChange={() => setSelectedOption('before')}
                  />
                  All Before Date
                </label>
              </div>
              
              {selectedOption === 'week' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Week Start Date (Monday)</label>
                  <input
                    type="date"
                    className="w-full p-2 border rounded"
                    value={weekStartDate}
                    onChange={(e) => setWeekStartDate(e.target.value)}
                    required
                  />
                </div>
              )}
              
              {selectedOption === 'before' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delete All Before Date</label>
                  <input
                    type="date"
                    className="w-full p-2 border rounded"
                    value={beforeDate}
                    onChange={(e) => setBeforeDate(e.target.value)}
                    required
                  />
                </div>
              )}
              
              {/* Confirmation warning */}
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-red-700 font-medium">
                  Warning: This action cannot be undone. All selected archived rotas will be permanently deleted.
                </p>
              </div>
            
            {operationResult && (
              <div className={`mt-4 p-3 rounded text-sm ${operationResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {operationResult.message}
              </div>
            )}
            
            <div className="flex justify-end space-x-2 mt-4">
              <button
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                onClick={() => setShowModal(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                onClick={handleDelete}
                disabled={loading || (selectedOption === 'week' && !weekStartDate) || (selectedOption === 'before' && !beforeDate)}
              >
                {loading ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
