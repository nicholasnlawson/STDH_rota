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
      "px-4 py-2 bg-blue-100 border-b-2 border-blue-600 font-medium text-blue-700" : 
      "px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50";
  };
  const [viewingWeekStart, setViewingWeekStart] = useState<string | null>(null);
  
  // Fetch pharmacists for name lookup
  const pharmacists = useQuery(api.pharmacists.list) || [];
  
  const archiveRotas = useMutation(api.rotas.archiveRotas);
  // Removed edit-related mutations
  // Fetch all rotas
  const rotas = useQuery(api.rotas.listRotas, {}) || [];

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

  // Helper to format publishedBy value using pharmacist list if possible
  function formatPublishedBy(publishedBy: string): string {
    if (!publishedBy) return 'Unknown User';
    // If publishedBy is already a full name (with or without email), extract the name
    if (publishedBy.includes('(') && publishedBy.includes(')')) {
      const nameMatch = publishedBy.match(/^([^(]+)\s*\(/);
      if (nameMatch && nameMatch[1]) {
        return nameMatch[1].trim();
      }
    }
    // If publishedBy looks like an email, try to resolve to a pharmacist name
    if (publishedBy.includes('@')) {
      const pharmacist = pharmacists.find((p: any) => p.email === publishedBy);
      if (pharmacist) return pharmacist.name;
      return publishedBy;
    }
    // If publishedBy is a username, try to resolve to a pharmacist name by username
    const pharmacist = pharmacists.find((p: any) => p.email.split('@')[0] === publishedBy);
    if (pharmacist) return pharmacist.name;
    // Otherwise, just return 
    return publishedBy;
  }

  // All rotas for the selected week
  const viewingWeekRotas = viewingWeekStart ? publishedRotasByWeek[viewingWeekStart] || [] : [];
  
  // Initialize mutations
  const archiveRotasMutation = useMutation(api.rotas.archiveRotas);
  
  // Handle archiving a rota
  const handleArchiveRota = async (weekStart: string) => {
    if (!window.confirm('Are you sure you want to archive this rota? This will move it to the archived section.')) {
      return;
    }
    
    try {
      await archiveRotasMutation({ weekStartDate: weekStart });
      // The list will automatically update due to the query
    } catch (error) {
      console.error('Error archiving rota:', error);
      alert('Failed to archive rota. Please try again.');
    }
  };

  // Handle archiving a rota (legacy function)
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
  


  // If the user is viewing a specific rota, display that instead of the list
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
      <div className="w-full">
        <div className="flex border-b fixed-width">
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
        <div className="mt-6 p-4 text-left">
          <div className="flex justify-between items-center mb-4 px-4">
            <h2 className="text-2xl font-semibold">Rota for week starting {viewingWeekStart}</h2>
            <div className="flex space-x-2">
              <button
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                onClick={() => setViewingWeekStart(null)}
              >
                Close
              </button>
            </div>
          </div>
          
          {/* Display the published rota information */}
          <div className="bg-blue-50 p-4 mb-6 rounded-lg border border-blue-200">
            <div className="flex flex-wrap justify-between items-center">
              <div>
                <p className="text-sm text-blue-800">
                  <strong>Published by:</strong> {formatPublishedBy(viewingWeekRotas[0].publishedBy)}<br/>
                  <strong>Published on:</strong> {viewingWeekRotas[0].publishDate ? `${viewingWeekRotas[0].publishDate}, ${viewingWeekRotas[0].publishTime || ''}` : 'Unknown'}
                </p>
              </div>
              {isAdmin && (
                <div>
                  <button
                    onClick={() => onArchiveRota(viewingWeekStart)}
                    className="px-3 py-1 bg-orange-500 text-white rounded-md hover:bg-orange-600 text-sm"
                  >
                    Archive This Rota
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Display the rota using RotaView in view-only or edit mode */}
          <RotaView 
            isViewOnly={true} /* Always view-only for published rotas */
            initialSelectedMonday={viewingWeekStart}
            initialRotaAssignments={allAssignments}
            initialRotaIdsByDate={rotaIdsByDate}
            publishedRota={viewingWeekStart && publishedRotasByWeek[viewingWeekStart] ? publishedRotasByWeek[viewingWeekStart][0] : null} /* Pass the first rota from current week for proper weekday handling */
            /* Removed onEditsChanged handler as edit functionality is removed */
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Fixed tab bar that stays in place - always at the top level */}
      <div className="flex border-b fixed-width">
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
      
      {/* Content area that changes based on active tab */}
      <div className="mt-6">
        {activeTab === "archived" ? (
          <ArchivedRotasList isAdmin={isAdmin} />
        ) : (
          <>
            {uniqueWeeks.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No published rotas available.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uniqueWeeks.map(weekStart => {
                  // Get the first rota for this week to display the metadata
                  const firstRotaInWeek = publishedRotasByWeek[weekStart][0];
                  if (!firstRotaInWeek) return null;
                  
                  return (
                    <div key={weekStart} className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow">
                      <div className="p-4">
                        <h3 className="font-semibold text-lg text-gray-800 mb-3">Week of {weekStart}</h3>
                        <div className="space-y-2 text-sm text-gray-600 mb-4">
                          <div>
                            <span className="font-medium">Published by:</span> {formatPublishedBy(firstRotaInWeek.publishedBy)}
                          </div>
                          <div>
                            <span className="font-medium">Published on:</span> {firstRotaInWeek.publishDate ? `${firstRotaInWeek.publishDate}, ${firstRotaInWeek.publishTime || ''}` : 'Unknown'}
                          </div>
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
                              onClick={() => handleArchiveRota(weekStart)}
                              className="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors whitespace-nowrap"
                              title="Archive rota"
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
          </>
        )}
      </div>
    </div>
  );
}
