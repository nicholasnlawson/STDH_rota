import React from "react";
import { SignOutButton } from "./SignOutButton";

interface AppHeaderProps {
  currentUser: {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  } | null;
  onSignOut: () => void;
}

export function AppHeader({ currentUser, onSignOut }: AppHeaderProps) {
  return (
    <div className="fixed top-0 right-0 left-0 bg-white shadow-md z-50 px-4 py-2">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold mr-2">Pharmacy Rota Management</h1>
          {currentUser && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
              {currentUser.isAdmin ? 'Admin' : 'Pharmacist'}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {currentUser && (
            <div className="mr-4 text-sm">
              <span className="text-gray-500">Logged in as: </span>
              <span className="font-medium">{currentUser.name}</span>
            </div>
          )}
          <SignOutButton onSignOut={onSignOut} />
        </div>
      </div>
    </div>
  );
}
