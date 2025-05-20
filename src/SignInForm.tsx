"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

export function SignInForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const authenticatePharmacist = useMutation(api.auth.authenticatePharmacist);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    
    try {
      const result = await authenticatePharmacist({ email, password });
      
      if (result.success && result.pharmacist) {
        // Store pharmacist info in localStorage for use across the app
        const userData = {
          id: result.pharmacist._id,
          name: result.pharmacist.name,
          email: result.pharmacist.email,
          isAdmin: result.pharmacist.isAdmin || false,
          sessionToken: `${Date.now()}_${result.pharmacist._id}_${Math.random().toString(36).substring(2, 15)}`
        };
        
        localStorage.setItem('user', JSON.stringify(userData));
        toast.success(`Welcome, ${result.pharmacist.name || 'User'}!`);
        window.location.href = '/';
      } else {
        setError("Login failed. Please check your email and password and try again.");
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }
  
  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold mb-6 text-center">Pharmacy Rota System</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <form className="flex flex-col gap-4" onSubmit={handleLogin}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email Address
          </label>
          <input 
            id="email" 
            name="email"
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input 
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button> 
      </form>
    </div>
  );
}
