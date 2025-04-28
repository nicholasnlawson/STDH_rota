import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Anonymous],
});

export const loggedInUser = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }
    return user;
  },
});

// Function to authenticate a user against the pharmacists database
export const authenticatePharmacist = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the pharmacist with the matching email
    const pharmacists = await ctx.db
      .query("pharmacists")
      .filter((q) => q.eq(q.field("email"), args.email))
      .collect();

    // If no pharmacist is found, return null
    if (pharmacists.length === 0) {
      return {
        success: false,
        message: "No pharmacist found with this email."
      };
    }

    const pharmacist = pharmacists[0];

    // For simplicity in this implementation, we'll use email as username and compare with a fixed password
    // In a real system, you would use proper password hashing and comparison
    // This is a placeholder for demonstration purposes
    if (args.password === "pharmacist123") { // Using a fixed password for all pharmacists for simplicity
      // Return the pharmacist data with success flag
      return {
        success: true,
        pharmacist: pharmacist,
      };
    } else {
      return {
        success: false,
        message: "Invalid password."
      };
    }
  },
});
