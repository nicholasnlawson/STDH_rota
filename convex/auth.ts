import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { compare, hash } from "bcryptjs";
import { Id } from "./_generated/dataModel";

// Function to authenticate a pharmacist against the pharmacists database
export const authenticatePharmacist = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[AUTH] Authentication attempt for email:", args.email);
    
    // Query the database for the pharmacist with the given email
    console.log("[AUTH] Querying database for pharmacist with email:", args.email);
    const pharmacists = await ctx.db
      .query("pharmacists")
      .filter(q => q.eq(q.field("email"), args.email))
      .collect();
    
    console.log("[AUTH] Found pharmacists:", pharmacists.length);
    
    // Check if pharmacist exists
    if (pharmacists.length === 0) {
      return {
        success: false,
        message: "Pharmacist with this email not found",
      };
    }
    
    const pharmacist = pharmacists[0];
    console.log("[AUTH] Found pharmacist:", {
      id: pharmacist._id,
      email: pharmacist.email,
      hasPassword: !!pharmacist.password,
    });
    
    // Compare password (very simple check for demonstration)
    console.log("[AUTH] Comparing provided password with stored password");
    if (pharmacist.password !== args.password) {
      return {
        success: false,
        message: "Incorrect password",
      };
    }
    
    console.log("[AUTH] Password match, authentication successful");
    
    // Authentication successful
    return {
      success: true,
      pharmacist: {
        _id: pharmacist._id,
        name: pharmacist.name,
        email: pharmacist.email,
        isAdmin: pharmacist.isAdmin || false,
      },
    };
  },
});

// Check if a user is authenticated based on the session token
export const checkAuth = query({
  args: {
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // In a real implementation, you would validate the session token
    // For now, we'll just check if it exists
    const hasToken = !!args.sessionToken;
    
    return {
      isAuthenticated: hasToken,
    };
  },
});

// Change password for a pharmacist
export const changePassword = mutation({
  args: {
    email: v.string(),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[AUTH] Change password requested for:", args.email);
    
    // Query the database for the pharmacist with the given email
    const pharmacists = await ctx.db
      .query("pharmacists")
      .filter(q => q.eq(q.field("email"), args.email))
      .collect();
    
    if (pharmacists.length === 0) {
      throw new Error("No pharmacist found with this email");
    }
    
    const pharmacist = pharmacists[0];
    
    // Verify current password
    const passwordMatch = await compare(args.currentPassword, pharmacist.password || "");
    if (!passwordMatch) {
      throw new Error("Current password is incorrect");
    }
    
    // Hash the new password
    const hashedPassword = await hash(args.newPassword, 10);
    
    // Update the pharmacist's password
    await ctx.db.patch(pharmacist._id, {
      password: hashedPassword
    });
    
    return { success: true };
  },
});

// Function to verify Auth0 token
async function verifyAuth0Token(token: string): Promise<{ email: string; sub: string }> {
  try {
    const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Invalid token');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error verifying token:', error);
    throw new Error('Invalid token');
  }
}

// Admin function to reset a user's password
export const adminResetPassword = mutation({
  args: {
    adminSessionToken: v.string(), // Auth0 access token
    targetEmail: v.string(), // Email of the user whose password to reset
    newPassword: v.string(), // New password to set
  },
  handler: async (ctx, args) => {
    console.log("[AUTH] Admin password reset requested");
    
    try {
      // Verify the Auth0 token
      const userInfo = await verifyAuth0Token(args.adminSessionToken);
      console.log("[AUTH] Verified user:", userInfo.email);
      
      // Find the admin user in the pharmacists table
      const adminUsers = await ctx.db
        .query("pharmacists")
        .filter(q => q.eq(q.field("email"), userInfo.email))
        .collect();
        
      const adminUser = adminUsers[0];
      console.log("[AUTH] Admin user from DB:", adminUser);
      
        if (!adminUser || !adminUser.isAdmin) {
        console.error("[AUTH] User is not an admin or not found:", userInfo.email);
        throw new Error("Admin privileges required");
      }
      
      // Find the target user
      const targetUsers = await ctx.db
        .query("pharmacists")
        .filter(q => q.eq(q.field("email"), args.targetEmail))
        .collect();
        
      if (targetUsers.length === 0) {
        console.error("[AUTH] Target user not found:", args.targetEmail);
        throw new Error("No user found with the specified email");
      }
      
      const targetUser = targetUsers[0];
      console.log("[AUTH] Target user found:", targetUser._id);
      
      // Hash the new password
      const hashedPassword = await hash(args.newPassword, 10);
      
      // Update the user's password
      await ctx.db.patch(targetUser._id, {
        password: hashedPassword
      });
      
      console.log("[AUTH] Password reset successful for:", args.targetEmail);
      
      return { 
        success: true, 
        message: `Password for ${args.targetEmail} has been reset successfully` 
      };
    } catch (error) {
      console.error("[AUTH] Error in adminResetPassword:", error);
      throw error;
    }
  },
});
