import { internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Internal mutation to clean up old draft rotas
export const cleanUpOldDraftRotas = internalMutation({
  handler: async (ctx) => {
    // Get all rotas
    const allRotas = await ctx.db.query("rotas").collect();
    
    // Calculate date 2 months ago
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const twoMonthsAgoStr = twoMonthsAgo.toISOString().split('T')[0];
    
    console.log(`[cleanup] Looking for draft rotas older than ${twoMonthsAgoStr}`);
    
    // Filter draft rotas older than 2 months
    const rotasToDelete = allRotas.filter((rota: any) => {
      return rota.status === 'draft' && rota.date && rota.date < twoMonthsAgoStr;
    });
    
    console.log(`[cleanup] Found ${rotasToDelete.length} old draft rotas to delete`);
    
    // Delete each old draft rota
    let deletedCount = 0;
    for (const rota of rotasToDelete) {
      try {
        await ctx.db.delete(rota._id as Id<"rotas">);
        console.log(`[cleanup] Deleted old draft rota ${rota._id} from ${rota.date}`);
        deletedCount++;
      } catch (error) {
        console.error(`[cleanup] Error deleting rota ${rota._id}:`, error);
      }
    }
    
    return {
      success: true,
      message: `Successfully deleted ${deletedCount} old draft rotas.`,
      deletedCount,
      totalFound: rotasToDelete.length
    };
  },
});
