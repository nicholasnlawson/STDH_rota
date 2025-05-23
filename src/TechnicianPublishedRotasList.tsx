import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { TechnicianRotaView } from "./TechnicianRotaView";
import { Id } from "../convex/_generated/dataModel";

// Helper function to get Monday date for any date in the week
function getWeekStartDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 1 = Monday, 0 = Sunday
  date.setDate(date.getDate() + diff);
  return date.toISOString().split('T')[0];
}

// Helper function to format publishedBy value
function formatPublishedBy(publishedBy: any): string {
  if (!publishedBy) return 'Unknown User';
  // If publishedBy is an object with name and email
  if (typeof publishedBy === 'object' && publishedBy.name) {
    return publishedBy.name;
  }
  // If it's a string, try to extract the name part
  if (typeof publishedBy === 'string') {
    if (publishedBy.includes('(') && publishedBy.includes(')')) {
      const nameMatch = publishedBy.match(/^([^(]+)\s*\(/);
      if (nameMatch && nameMatch[1]) {
        return nameMatch[1].trim();
      }
    }
    return publishedBy;
  }
  return 'Unknown User';
}

interface TechnicianPublishedRotasListProps {
  isAdmin?: boolean;
}

type TabType = "published" | "archived";

export function TechnicianPublishedRotasList({ isAdmin = false }: TechnicianPublishedRotasListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("published");
  const [viewingWeekStart, setViewingWeekStart] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState(false);
  const archiveRota = useMutation(api.technicianRotas.archiveRota);

  // Helper function for tab button classes
  const getTabClass = (tabName: TabType): string => {
    return activeTab === tabName 
      ? "px-4 py-2 bg-blue-100 border-b-2 border-blue-600 font-medium text-blue-700" 
      : "px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50";
  };

  // Fetch all technician rotas based on active tab
  const rotas = useQuery(api.technicianRotas.listRotas, { 
    status: activeTab === "published" ? "published" : "archived" 
  }) || [];

  // Group rotas by week start date (Monday)
  const rotasByWeek = rotas.reduce((groups: Record<string, any[]>, rota: any) => {
    const weekStart = getWeekStartDate(rota.date);
    if (!groups[weekStart]) {
      groups[weekStart] = [];
    }
    groups[weekStart].push(rota);
    return groups;
  }, {});

  // Get unique weeks for display in the table
  const uniqueWeeks = Object.keys(rotasByWeek).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );

  // Handle archiving a rota
  const handleArchiveRota = async (rotaId: Id<"technicianRotas">, weekStart: string) => {
    if (!window.confirm('Are you sure you want to archive this rota? This will move it to the archived section.')) {
      return;
    }
    
    try {
      setIsArchiving(true);
      await archiveRota({ rotaId, weekStartDate: weekStart });
      setArchiveSuccess(true);
      setTimeout(() => setArchiveSuccess(false), 3000);
    } catch (error) {
      console.error('Error archiving rota:', error);
      alert('Failed to archive rota. Please try again.');
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="w-full">
      {/* Tab buttons */}
      <div className="flex border-b">
        <button
          className={getTabClass('published')}
          onClick={() => setActiveTab('published')}
        >
          Published Rotas
        </button>
        <button
          className={getTabClass('archived')}
          onClick={() => setActiveTab('archived')}
        >
          Archived Rotas
        </button>
      </div>
      <div className="mt-6">
        {activeTab === 'archived' ? (
          <div className="p-4 w-full">
            {archiveSuccess && (
              <div className="mb-4 p-2 bg-green-100 text-green-800 rounded">
                Rota archived successfully!
              </div>
            )}
            
            {uniqueWeeks.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No archived technician rotas available.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uniqueWeeks.map(weekStart => {
                  // Get the first rota for this week to display the metadata
                  const firstRotaInWeek = rotasByWeek[weekStart][0];
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
                          <div className="flex gap-2 w-full">
                            <button
                              onClick={() => setViewingWeekStart(weekStart)}
                              className={`w-full py-2 text-white rounded transition-colors bg-yellow-600 hover:bg-yellow-700`}
                            >
                              View Rota
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 w-full">
            {archiveSuccess && (
              <div className="mb-4 p-2 bg-green-100 text-green-800 rounded">
                Rota archived successfully!
              </div>
            )}
            
            {uniqueWeeks.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No published technician rotas available.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uniqueWeeks.map(weekStart => {
                  // Get the first rota for this week to display the metadata
                  const firstRotaInWeek = rotasByWeek[weekStart][0];
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
                          <div className="flex gap-2 w-full">
                            <button
                              onClick={() => setViewingWeekStart(weekStart)}
                              className={`w-full py-2 text-white rounded transition-colors bg-blue-600 hover:bg-blue-700`}
                            >
                              View Rota
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleArchiveRota(firstRotaInWeek._id, weekStart)}
                                disabled={isArchiving}
                                className="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors whitespace-nowrap"
                                title="Archive rota"
                              >
                                {isArchiving ? 'Archiving...' : 'Archive'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {viewingWeekStart && rotasByWeek[viewingWeekStart]?.length > 0 && (
          <div className="w-full mt-6 p-4 text-left">
            <div className="flex justify-between items-center mb-4 px-4">
              <h2 className="text-2xl font-semibold">Technician Rota for week starting {viewingWeekStart}</h2>
              <div className="flex space-x-2">
                <button
                  className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                  onClick={() => setViewingWeekStart(null)}
                >
                  Close
                </button>
              </div>
            </div>
            
            {/* Published rota info box */}
            <div className="bg-blue-50 p-4 mb-6 rounded-lg border border-blue-200">
              <div className="flex flex-wrap justify-between items-center">
                <div>
                  <p className="text-sm text-blue-800">
                    <strong>Published by:</strong> {formatPublishedBy(rotasByWeek[viewingWeekStart][0].publishedBy)}<br/>
                    <strong>Published on:</strong> {rotasByWeek[viewingWeekStart][0].publishDate ? `${rotasByWeek[viewingWeekStart][0].publishDate}, ${rotasByWeek[viewingWeekStart][0].publishTime || ''}` : 'Unknown'}
                  </p>
                </div>
                {isAdmin && activeTab === 'published' && (
                  <div>
                    <button
                      onClick={() => handleArchiveRota(rotasByWeek[viewingWeekStart][0]._id, viewingWeekStart)}
                      disabled={isArchiving}
                      className="px-3 py-1 bg-orange-500 text-white rounded-md hover:bg-orange-600 text-sm"
                    >
                      {isArchiving ? 'Archiving...' : 'Archive This Rota'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {/* Display the rota using TechnicianRotaView in view-only mode */}
            <TechnicianRotaView
              isViewOnly={true}
              initialSelectedMonday={viewingWeekStart}
              initialRotaAssignments={rotasByWeek[viewingWeekStart].flatMap(rota => 
                rota.assignments.map((a: any) => ({ ...a, date: a.date || rota.date }))
              )}
              initialRotaIdsByDate={rotasByWeek[viewingWeekStart].reduce((acc, rota) => {
                if (rota.date) {
                  acc[rota.date] = rota._id as Id<"technicianRotas">;
                }
                return acc;
              }, {})}
              publishedRota={rotasByWeek[viewingWeekStart][0]}
            />
          </div>
        )}
      </div>

    </div>
  );
}
