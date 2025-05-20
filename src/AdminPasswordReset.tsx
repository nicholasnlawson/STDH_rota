import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useAuth0 } from "@auth0/auth0-react";
import { Id } from "../convex/_generated/dataModel";

export function AdminPasswordReset() {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  
  const resetPassword = useMutation(api.auth.adminResetPassword);
  
  const { user, getAccessTokenSilently } = useAuth0();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !newPassword) {
      setMessage({ text: "Please fill in all fields", isError: true });
      return;
    }
    
    setIsLoading(true);
    setMessage(null);
    
    try {
      if (!user || !user.email) {
        throw new Error("You must be logged in to perform this action");
      }
      
      // Get the current user's session token
      const token = await getAccessTokenSilently();
      
      if (!token) {
        throw new Error("Could not get session token. Please log in again.");
      }
      
      // Call the reset password mutation
      await resetPassword({
        adminSessionToken: token,
        targetEmail: email,
        newPassword,
      });
      
      setMessage({ 
        text: `Password for ${email} has been reset successfully`, 
        isError: false 
      });
      
      // Clear the form
      setEmail("");
      setNewPassword("");
    } catch (error) {
      console.error("Error resetting password:", error);
      setMessage({ 
        text: error instanceof Error ? error.message : "Failed to reset password", 
        isError: true 
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Reset User Password</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            User's Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Enter user's email"
            required
          />
        </div>
        
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
            New Password
          </label>
          <input
            type="password"
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Enter new password"
            required
            minLength={8}
          />
          <p className="mt-1 text-xs text-gray-500">
            Password must be at least 8 characters long
          </p>
        </div>
        
        <div>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Resetting Password...' : 'Reset Password'}
          </button>
        </div>
        
        {message && (
          <div className={`mt-4 p-3 rounded-md ${message.isError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}
