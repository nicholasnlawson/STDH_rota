import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { hash } from "bcrypt";

/**
 * Create a new admin user
 * This is a one-time setup function to create the first admin user
 */
export const createAdminUser = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Since we're using Convex's built-in auth, we'll create a user in the users table
    // and set up the authentication separately
    
    // First, check if a user with this email already exists in the users table
    const existingUser = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();

    if (existingUser) {
      return { success: false, message: "User with this email already exists" };
    }

    // Create the user in the users table with only valid fields from the base Convex auth schema
    const userId = await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      // Note: We can't set admin flag here as it's not part of the base schema
      // You'll need to update this user in the Convex dashboard to mark them as admin
      emailVerificationTime: Date.now(),
    });
    
    console.log(`Created user with ID: ${userId}`);
    console.log('Please update this user in the Convex dashboard to mark them as an admin.');

    // For the password, since we're using Convex's built-in auth,
    // you'll need to set the password through the auth system
    // This might require using the Convex dashboard or a separate auth setup
    
    return { 
      success: true, 
      userId,
      message: "Admin user created. Please set up authentication separately."
    };
  },
});
