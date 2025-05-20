"use client";

interface SignOutButtonProps {
  onSignOut?: () => void;
}

export function SignOutButton({ onSignOut }: SignOutButtonProps) {
  // Check if we're in the browser environment and if a user is logged in
  const isAuthenticated = typeof window !== 'undefined' && 
    localStorage.getItem('user') !== null;
  
  // Don't show the button if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  const handleSignOut = () => {
    try {
      // Clear user data from localStorage
      localStorage.removeItem('user');
      
      // Call the custom onSignOut handler for any additional cleanup
      if (onSignOut) {
        onSignOut();
      }

      // Force a reload of the page to reset all states
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
      // Force reload as fallback
      window.location.reload();
    }
  };

  return (
    <button 
      className="px-4 py-2 rounded-lg transition-colors bg-red-600 text-white shadow-md hover:bg-red-700 hover:shadow-lg flex items-center font-medium"
      onClick={handleSignOut}
      aria-label="Sign out"
    >
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className="h-5 w-5 mr-1.5" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Log Out
    </button>
  );
}
