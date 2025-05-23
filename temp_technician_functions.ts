// List all rotas
export const listRotas = query({
  args: {
    status: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    let rotasQuery = ctx.db.query("technicianRotas");
    
    // Filter by status if provided
    if (args.status) {
      rotasQuery = rotasQuery.filter(q => q.eq(q.field("status"), args.status));
    }
    
    // Sort by date descending (newest first)
    rotasQuery = rotasQuery.order("desc");
    
    return await rotasQuery.collect();
  }
});

// Generate a weekly rota
export const generateWeeklyRota = mutation({
  args: {
    startDate: v.string(),
    technicianIds: v.array(v.id("technicians")),
    selectedWeekdays: v.optional(v.array(v.string())),
    ignoredUnavailableRules: v.optional(v.object({
      technicianId: v.string(),
      ruleIndices: v.array(v.number())
    })),
    includeWarfarinClinics: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const rotaIdsByDate: Record<string, Id<"technicianRotas">> = {};
    const allAssignments: any[] = [];
    
    // Start with the provided date (should be a Monday)
    const startDate = new Date(args.startDate);
    
    // Generate rotas for the next 7 days
    for (let i = 0; i < 7; i++) {
      // Calculate the date for this iteration
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateString = currentDate.toISOString().split('T')[0];
      
      try {
        // Generate rota for this day
        const result = await ctx.runMutation(internal.technicianRotas.generateTechnicianRota, {
          date: dateString,
          technicianIds: args.technicianIds,
          includeWarfarinClinics: args.includeWarfarinClinics,
          ignoredUnavailableRules: args.ignoredUnavailableRules,
          selectedWeekdays: args.selectedWeekdays
        });
        
        // Store the rota ID for this date
        rotaIdsByDate[dateString] = result.rotaId;
        
        // Append this day's assignments to the overall assignments list
        result.assignments.forEach(assignment => {
          allAssignments.push({
            ...assignment,
            date: dateString,
            rotaId: result.rotaId
          });
        });
        
        console.log(`Generated rota for ${dateString} with ${result.assignments.length} assignments`);
      } catch (error) {
        console.error(`Error generating rota for ${dateString}:`, error);
      }
    }
    
    return {
      rotaIdsByDate,
      assignments: allAssignments
    };
  }
});
