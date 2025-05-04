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
  const [confirmation, setConfirmation] = useState('');
  const [operationResult, setOperationResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'week' | 'before'>('week');

  // Get all archived rotas to display statistics
  const archivedRotas = useQuery(api.rotas.listRotas, { status: "archived" }) || [];
  const deleteArchivedRotas = useMutation(api.rotas.deleteArchivedRotas);

  // Group archived rotas by week
  const rotasByWeek = archivedRotas.reduce((acc: Record<string, any[]>, rota: any) => {
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
    // Simply verify that the user wants to proceed
    setLoading(true);
    try {
      // Call the mutation with the selected parameters
      const result = await deleteArchivedRotas({
        weekStartDate: selectedOption === 'week' ? weekStartDate : undefined,
        beforeDate: selectedOption === 'before' ? beforeDate : undefined,
        adminConfirmation: 'CONFIRM_DELETE_ARCHIVED_ROTAS' // Automatically include the confirmation
      });
      
      // Hide detailed operation result and just show simple message
      if (result.deletedCount > 0) {
        setOperationResult({
          success: true,
          message: `Successfully deleted ${result.deletedCount} days of archived rota data.`
        });
      } else {
        setOperationResult({
          success: false,
          message: 'No rota data matched your criteria.'
        });
      }
      
      // Close modal after short delay
      setTimeout(() => setShowModal(false), 2000);
    } catch (error) {
      console.error('Error deleting rotas:', error);
      setOperationResult({ 
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Admin Rota Management</h2>
      
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Archived Rotas Statistics</h3>
        <p className="text-sm text-gray-700 mb-2">Total archived rotas: <span className="font-bold">{archivedRotas.length}</span></p>
        
        <div className="mt-4">
          <h4 className="font-medium mb-2">Archived Rotas by Week:</h4>
          <div className="max-h-60 overflow-y-auto border rounded p-2">
            {Object.keys(rotasByWeek).sort().map(weekStart => (
              <div key={weekStart} className="mb-2 p-2 bg-gray-50 rounded">
                <p className="text-sm">
                  <span className="font-semibold">Week starting {formatDate(weekStart)}</span>: 
                  {' '}{rotasByWeek[weekStart].length} days
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-6">
        <button
          onClick={() => setShowModal(true)}
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
        >
          Delete Archived Rotas
        </button>
      </div>

      {/* Delete Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Delete Archived Rotas</h3>
            <p className="text-red-600 font-medium mb-4">Warning: This action cannot be undone.</p>
            
            <div className="mb-4">
              <div className="flex space-x-4 mb-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={selectedOption === 'week'}
                    onChange={() => setSelectedOption('week')}
                    className="mr-2"
                  />
                  <span>Delete by week</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="deleteOption"
                    checked={selectedOption === 'before'}
                    onChange={() => setSelectedOption('before')}
                    className="mr-2"
                  />
                  <span>Delete before date</span>
                </label>
              </div>
              
              {selectedOption === 'week' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Week starting (Monday):</label>
                  <select 
                    className="border rounded p-2 w-full"
                    value={weekStartDate}
                    onChange={(e) => setWeekStartDate(e.target.value)}
                  >
                    <option value="">Select a week</option>
                    {Object.keys(rotasByWeek).sort().map(week => (
                      <option key={week} value={week}>
                        {formatDate(week)} - {rotasByWeek[week].length} days
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
              {selectedOption === 'before' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Delete all archived rotas before:</label>
                  <input
                    type="date"
                    className="border rounded p-2 w-full"
                    value={beforeDate}
                    onChange={(e) => setBeforeDate(e.target.value)}
                  />
                </div>
              )}
            </div>
            
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-red-700 mb-2">
                <strong>Warning:</strong> This action will permanently delete the selected archived rota data.
              </p>
              <p className="text-red-700 text-sm">
                This cannot be undone. Make sure you have backups if needed.
              </p>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading || 
                  (selectedOption === 'week' && !weekStartDate) || 
                  (selectedOption === 'before' && !beforeDate)}
                className={`px-4 py-2 rounded text-white ${
                  loading || 
                  (selectedOption === 'week' && !weekStartDate) || 
                  (selectedOption === 'before' && !beforeDate)
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {loading ? 'Deleting...' : 'Delete Data'}
              </button>
            </div>
            
            {operationResult && (
              <div className={`mt-4 p-3 rounded text-sm ${operationResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {operationResult.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
