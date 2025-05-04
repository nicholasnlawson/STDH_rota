"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

export function SignInForm() {
  const { signIn } = useAuthActions();
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const authenticatePharmacist = useMutation(api.auth.authenticatePharmacist);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      // First verify if the user is a pharmacist in the database
      const result = await authenticatePharmacist({ email, password });
      
      if (result.success && result.pharmacist) {
        // If authentication is successful, use the Convex auth system to create a session
        // For simplicity, we're using the anonymous provider as the actual authentication
        // has already been done with our custom authenticatePharmacist function
        void signIn("anonymous").then(() => {
          toast.success(`Welcome, ${result.pharmacist?.firstName || result.pharmacist?.name || 'Pharmacist'}!`);
          
          // Store pharmacist info in localStorage for use across the app
          localStorage.setItem('currentPharmacist', JSON.stringify({
            id: result.pharmacist._id,
            name: result.pharmacist.displayName || result.pharmacist.name,
            email: result.pharmacist.email,
            isAdmin: result.pharmacist.isAdmin
          }));
        });
      } else {
        toast.error(result.message || "Authentication failed");
        setSubmitting(false);
      }
    } catch (error) {
      console.error("Login error:", error);
      toast.error("An error occurred during login");
      setSubmitting(false);
    }
  }
  
  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold mb-6 text-center">Pharmacy Rota System</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={handleLogin}
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
          <input 
            id="email" 
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" 
            required 
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input 
            id="password" 
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" 
            required 
            autoComplete="current-password"
          />
        </div>
        <button 
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" 
          type="submit" 
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
        
        <div className="text-center text-sm text-gray-500 mt-4">
          <p className="mb-2">For demo, use your email and password: pharmacist123</p>
          <p>Only registered pharmacists can log in.</p>
        </div>
      </form>
    </div>
  );
}
