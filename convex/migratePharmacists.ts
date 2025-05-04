import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Query to find all pharmacists with firstName and lastName fields
export const findPharmaciststoMigrate = query({
  handler: async (ctx) => {
    const pharmacists = await ctx.db.query("pharmacists").collect();
    return pharmacists.filter(p => "firstName" in p || "lastName" in p);
  },
});

// Migration to remove firstName and lastName fields from pharmacists
export const removeFirstLastName = mutation({
  handler: async (ctx) => {
    const pharmacistsToMigrate = await ctx.db.query("pharmacists").collect();
    
    let migrated = 0;
    for (const pharmacist of pharmacistsToMigrate) {
      // Skip records that don't have the legacy fields
      if (!("firstName" in pharmacist) && !("lastName" in pharmacist)) {
        continue;
      }

      // Make a clean copy without firstName and lastName fields
      const {
        // @ts-ignore - we know these fields exist in some docs
        firstName, lastName,
        ...cleanPharmacist
      } = pharmacist;

      // Replace the document with the clean version
      await ctx.db.replace(pharmacist._id, cleanPharmacist);
      migrated++;
    }
    
    return { migrated };
  },
});
