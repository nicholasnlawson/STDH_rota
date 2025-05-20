import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { compare, hash } from "bcrypt";

// Function to directly authenticate an admin user without relying on Convex Auth
export const directAdminSignIn = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the user with the given email
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();

    if (!user) {
      return { success: false, message: "No user found with this email" };
    }

    // For simplicity, let's use a hardcoded password for the admin initially
    // In a production environment, you should properly hash and store the password
    const adminPassword = "admin123"; // Use a secure password in production

    // Compare the provided password with the admin password
    if (args.password !== adminPassword) {
      return { success: false, message: "Incorrect password" };
    }

    // Generate a simple session token (in production, use a proper JWT library)
    const sessionId = crypto.randomUUID();
    
    // Store the session in the database
    await ctx.db.insert("sessions", {
      userId: user._id,
      sessionId,
      createdAt: Date.now(),
    });

    return {
      success: true,
      user,
      sessionId,
    };
  },
});

// Verify a session and get the user
export const verifyAdminSession = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      return { success: false, message: "Invalid or expired session" };
    }

    const user = await ctx.db.get(session.userId);
    
    if (!user) {
      return { success: false, message: "User not found" };
    }

    return {
      success: true,
      user,
    };
  },
});
