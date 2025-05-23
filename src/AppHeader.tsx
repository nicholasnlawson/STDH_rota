import { SignOutButton } from "./SignOutButton";
import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

interface AppHeaderProps {
  onSignOut: () => void;
}

export function AppHeader({ onSignOut }: AppHeaderProps) {
  // Get user info from localStorage
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const location = useLocation();

  // Check if current path is active
  const isActive = (path: string) => {
    return location.pathname.startsWith(path);
  };

  // Common styles
  const baseClass = 'px-3 py-1 rounded text-sm font-medium transition-colors';
  
  // Button style classes
  const getButtonClass = (path: string) => {
    const activeClass = isActive(path) 
      ? 'bg-blue-600 text-white' 
      : 'text-gray-700 hover:bg-gray-100';
    return `${baseClass} ${activeClass}`;
  };
  
  // Create dropdown state
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false);
  
  // Close dropdown when clicking outside
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAdminDropdownOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="fixed top-0 right-0 left-0 bg-white shadow-md z-50 px-4 py-2">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold mr-6">Pharmacy Rota Management</h1>
          
          {/* Navigation Links */}
          <nav className="flex items-center space-x-1">
            <Link 
              to="/pharmacist" 
              className={getButtonClass('/pharmacist')}
            >
              Pharmacist Rota
            </Link>
            <Link 
              to="/technician" 
              className={getButtonClass('/technician')}
            >
              Technician Rota
            </Link>
            
            {/* Admin Links - visible only to admins */}
            {user?.isAdmin && (
              <div className="relative ml-2" ref={dropdownRef}>
                <button
                  className={`${baseClass} ${adminDropdownOpen ? 'bg-gray-200' : 'hover:bg-gray-100'} text-gray-700 flex items-center`}
                  onClick={() => setAdminDropdownOpen(!adminDropdownOpen)}
                >
                  Admin
                  <svg className="ml-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                
                {adminDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10">
                    <Link 
                      to="/admin" 
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setAdminDropdownOpen(false)}
                    >
                      System Admin
                    </Link>
                  </div>
                )}
              </div>
            )}
          </nav>
          
          {user && (
            <span className="ml-4 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
              {user.isAdmin ? 'Admin' : 'Pharmacist'}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {user && (
            <div className="mr-4 text-sm">
              <span className="text-gray-500">Logged in as: </span>
              <span className="font-medium">{user.name}</span>
            </div>
          )}
          <SignOutButton onSignOut={onSignOut} />
        </div>
      </div>
    </div>
  );
}
