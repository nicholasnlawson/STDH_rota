"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

interface SignOutButtonProps {
  onSignOut?: () => void;
}

export function SignOutButton({ onSignOut }: SignOutButtonProps) {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <button 
      className="px-4 py-2 rounded-lg transition-colors bg-red-600 text-white shadow-md hover:bg-red-700 hover:shadow-lg flex items-center font-medium" 
      onClick={() => {
        void signOut();
        if (onSignOut) onSignOut();
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
      Log Out
    </button>
  );
}
