import { mutation } from "./_generated/server";

// Mutation to clean up old draft rotas
export const cleanUpOldDraftRotas = mutation({
  args: {},
  handler: async (ctx) => {
    // Calculate date 2 months ago
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const twoMonthsAgoStr = twoMonthsAgo.toISOString().split('T')[0];
    
    console.log(`[cleanUpOldDraftRotas] Looking for draft rotas older than ${twoMonthsAgoStr}`);
    
    try {
      // Get all rotas
      const allRotas = await ctx.db.query("rotas").collect();
      
      // Filter draft rotas older than 2 months
      const rotasToDelete = allRotas.filter((rota: any) => {
        return rota.status === 'draft' && rota.date && rota.date < twoMonthsAgoStr;
      });
      
      console.log(`[cleanUpOldDraftRotas] Found ${rotasToDelete.length} old draft rotas to delete`);
      
      // Delete each old draft rota
      let deletedCount = 0;
      for (const rota of rotasToDelete) {
        try {
          await ctx.db.delete(rota._id);
          console.log(`[cleanUpOldDraftRotas] Deleted old draft rota ${rota._id} from ${rota.date}`);
          deletedCount++;
        } catch (error) {
          console.error(`[cleanUpOldDraftRotas] Error deleting rota ${rota._id}:`, error);
        }
      }
      
      return {
        success: true,
        message: `Successfully deleted ${deletedCount} old draft rotas.`,
        deletedCount,
        totalFound: rotasToDelete.length
      };
      
    } catch (error) {
      console.error('[cleanUpOldDraftRotas] Error cleaning up old draft rotas:', error);
      throw error;
    }
  },
});

// Scheduled function that runs daily to clean up old draft rotas
// This should be called by your scheduled job
// Example: await ctx.scheduler.runAfter(0, internal.scheduledTasks.cleanUpOldDraftRotas, {});
