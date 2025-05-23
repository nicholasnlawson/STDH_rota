import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { RotaView } from "./RotaView";
import { Id } from "../convex/_generated/dataModel";

interface ArchivedRotasListProps {
  isAdmin?: boolean;
}

export function ArchivedRotasList({ isAdmin = false }: ArchivedRotasListProps) {
  const rotas = useQuery(api.rotas.listRotas, {}) || [];
  const [viewingWeekStart, setViewingWeekStart] = useState<string | null>(null);

  // Filter for archived rotas only
  const archivedRotas = rotas.filter((rota: any) => rota.status === "archived");
  
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
  
  // Group archived rotas by week start date (Monday)
  const archivedRotasByWeek = archivedRotas.reduce((groups: Record<string, any[]>, rota: any) => {
    const weekStart = getWeekStartDate(rota.date);
    if (!groups[weekStart]) {
      groups[weekStart] = [];
    }
    groups[weekStart].push(rota);
    return groups;
  }, {});
  
  // Get unique weeks for display in the table
  const uniqueWeeks = Object.keys(archivedRotasByWeek).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );

  // All rotas for the selected week
  const viewingWeekRotas = viewingWeekStart ? archivedRotasByWeek[viewingWeekStart] || [] : [];
  
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
          <h2 className="text-2xl font-semibold">Archived Rota for week starting {viewingWeekStart}</h2>
          <button
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            onClick={() => setViewingWeekStart(null)}
          >
            Close
          </button>
        </div>
        
        {/* Display the published rota information */}
        <div className="bg-yellow-50 p-4 mb-6 rounded-lg border border-yellow-200">
          <p className="text-sm text-yellow-800">
            <strong>Published by:</strong> {formatPublishedBy(viewingWeekRotas[0].publishedBy) || 'Unknown'}<br/>
            <strong>Published on:</strong> {viewingWeekRotas[0].publishDate ? `${viewingWeekRotas[0].publishDate}, ${viewingWeekRotas[0].publishTime || ''}` : 'Unknown'}
          </p>
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

  return (
    <div className="w-full">
      {uniqueWeeks.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No archived rotas available.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {uniqueWeeks.map(weekStart => {
            // Get the first rota for this week to display the metadata
            const firstRotaInWeek = archivedRotasByWeek[weekStart][0];
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
                  <button
                    onClick={() => setViewingWeekStart(weekStart)}
                    className="w-full py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
                  >
                    View Archived Rota
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
