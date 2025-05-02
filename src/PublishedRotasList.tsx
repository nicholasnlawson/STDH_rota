import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { RotaView } from "./RotaView";
import { ArchivedRotasList } from "./ArchivedRotasList";
import { Id } from "../convex/_generated/dataModel";

interface PublishedRotasListProps {
  isAdmin?: boolean;
}

type TabType = "published" | "archived";

export function PublishedRotasList({ isAdmin = false }: PublishedRotasListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("published");
  
  // Helper function to get tab button class
  const getTabClass = (tabName: TabType): string => {
    return activeTab === tabName ? 
      "px-4 py-2 bg-blue-100 border-b-2 border-blue-600" : 
      "px-4 py-2";
  };
  const [viewingWeekStart, setViewingWeekStart] = useState<string | null>(null);
  const [deleteConfirmWeek, setDeleteConfirmWeek] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Fetch pharmacists for name lookup
  const pharmacists = useQuery(api.pharmacists.list) || [];
  
  const archiveRotas = useMutation(api.rotas.archiveRotas);
  // Fetch all rotas
  const rotas = useQuery(api.rotas.listRotas) || [];

  // Filter for published rotas only (excluding archived)
  const publishedRotas = rotas.filter((rota: any) => rota.status === "published");
  
  // Group published rotas by week start date (Monday)
  const publishedRotasByWeek = publishedRotas.reduce((groups: Record<string, any[]>, rota: any) => {
    const weekStart = getWeekStartDate(rota.date);
    if (!groups[weekStart]) {
      groups[weekStart] = [];
    }
    groups[weekStart].push(rota);
    return groups;
  }, {});
  
  // Get unique weeks for display in the table
  const uniqueWeeks = Object.keys(publishedRotasByWeek).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );
  
  // Helper function to get Monday date for any date in the week
  function getWeekStartDate(dateStr: string): string {
    const date = new Date(dateStr);
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    // To get Monday, if the day is Sunday (0), go back 6 days, else go back (day-1) days
    const diff = day === 0 ? -6 : 1 - day; // Correct calculation for Monday
    date.setDate(date.getDate() + diff);
    return date.toISOString().split('T')[0];
  }

  // Helper to format publishedBy value
  function formatPublishedBy(publishedBy: string): string {
    if (!publishedBy) return 'Unknown';
    // If it includes an email in parentheses, extract just the name part
    if (publishedBy.includes('(') && publishedBy.includes(')')) {
      const nameMatch = publishedBy.match(/^([^(]+)\s*\(/); // Match everything before the first (
      if (nameMatch && nameMatch[1]) {
        return nameMatch[1].trim();
      }
    }
    return publishedBy;
  }

  // All rotas for the selected week
  const viewingWeekRotas = viewingWeekStart ? publishedRotasByWeek[viewingWeekStart] || [] : [];
  
  // Handle deleting a rota
  const handleDeleteRota = async () => {
    if (!deleteConfirmWeek) return;
    
    setIsDeleting(true);
    try {
      await archiveRotas({ weekStartDate: deleteConfirmWeek });
      alert("Rota archived successfully!");
      setDeleteConfirmWeek(null);
    } catch (error) {
      console.error("Error archiving rota:", error);
      alert(`Error archiving rota: ${error}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle archiving a rota
  const onArchiveRota = async (weekStartDate: string) => {
    if (confirm("Are you sure you want to archive this rota? This will move it to the Archived tab.")) {
      try {
        await archiveRotas({ weekStartDate });
        alert("Rota archived successfully!");
        // Refresh the data
        setViewingWeekStart(null);
      } catch (error) {
        console.error("Error archiving rota:", error);
        alert(`Error archiving rota: ${error}`);
      }
    }
  };
  
  // Only show the rota view if we have selected a week to view
  if (viewingWeekStart && viewingWeekRotas.length > 0) {
    // All assignments for the selected week
    const allAssignments = viewingWeekRotas.flatMap(rota => 
      rota.assignments.map((a: any) => ({ ...a, date: a.date || rota.date }))
    );
    
    // Create a map from date to rotaId, needed for the RotaView component
    const rotaIdsByDate: Record<string, Id<"rotas">> = {};
    viewingWeekRotas.forEach(rota => {
      if (rota.date) {
        rotaIdsByDate[rota.date] = rota._id;
      }
    });
    
    return (
      <div className="w-full max-w-5xl mx-auto mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Rota for week starting {viewingWeekStart}</h2>
          <button
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            onClick={() => setViewingWeekStart(null)}
          >
            Close
          </button>
        </div>
        
        {/* Display the published rota information */}
        <div className="bg-blue-50 p-4 mb-6 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Published by:</strong> {formatPublishedBy(viewingWeekRotas[0].publishedBy)}<br/>
            <strong>Published on:</strong> {viewingWeekRotas[0].publishDate ? `${viewingWeekRotas[0].publishDate}, ${viewingWeekRotas[0].publishTime || ''}` : 'Unknown'}
          </p>
          {isAdmin && (
            <div className="mt-2">
              <button
                onClick={() => onArchiveRota(viewingWeekStart)}
                className="px-3 py-1 bg-orange-500 text-white rounded-md hover:bg-orange-600 text-sm"
              >
                Archive This Rota
              </button>
            </div>
          )}
        </div>
        
        {/* Use the actual RotaView component to display the rota */}
        <RotaView 
          isViewOnly={true}
          initialSelectedMonday={viewingWeekStart}
          initialRotaAssignments={allAssignments}
          initialRotaIdsByDate={rotaIdsByDate}
        />
      </div>
    );
  }

  // Display the ArchivedRotasList when the archived tab is active
  if (activeTab === "archived") {
    return (
      <div className="p-4 max-w-6xl mx-auto">
        {/* Tab buttons */}
        <div className="flex mb-6 border-b">
          <button
            className={getTabClass("published")}
            onClick={() => setActiveTab("published")}
          >
            Published Rotas
          </button>
          <button
            className={getTabClass("archived")}
            onClick={() => setActiveTab("archived")}
          >
            Archived Rotas
          </button>
        </div>
        <ArchivedRotasList isAdmin={isAdmin} />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Tab buttons */}
      <div className="flex mb-6 border-b">
        <button
          className={getTabClass("published")}
          onClick={() => setActiveTab("published")}
        >
          Published Rotas
        </button>
        <button
          className={getTabClass("archived")}
          onClick={() => setActiveTab("archived")}
        >
          Archived Rotas
        </button>
      </div>
      <h2 className="text-2xl font-semibold mb-4 text-center">Published Rotas</h2>
      {uniqueWeeks.length === 0 ? (
        <div className="text-gray-500 text-center">No published rotas available.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {uniqueWeeks.map(weekStart => {
            // Get the first rota for this week to display the metadata
            const firstRotaInWeek = publishedRotasByWeek[weekStart][0];
            if (!firstRotaInWeek) return null;
            
            return (
              <div key={weekStart} className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2">Week of {weekStart}</h3>
                  <div className="text-sm text-gray-600 mb-3">
                    <p><span className="font-medium">Published by:</span> {formatPublishedBy(firstRotaInWeek.publishedBy)}</p>
                    <p>
                      <span className="font-medium">Published on:</span> {firstRotaInWeek.publishDate ? `${firstRotaInWeek.publishDate}, ${firstRotaInWeek.publishTime || ''}` : 'Unknown'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setViewingWeekStart(weekStart)}
                      className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      View Rota
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => onArchiveRota(weekStart)}
                        className="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Delete confirmation modal */}
      {deleteConfirmWeek && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Confirm Deletion</h2>
            <p className="mb-6">Are you sure you want to delete the rota for week starting {deleteConfirmWeek}? This action will archive the rota and remove it from the published list.</p>
            <div className="flex justify-end space-x-4">
              <button 
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                onClick={() => setDeleteConfirmWeek(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                onClick={handleDeleteRota}
                disabled={isDeleting}
              >
                {isDeleting ? "Archiving..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
