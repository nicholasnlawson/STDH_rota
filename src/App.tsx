import { SignInForm } from "./SignInForm";
import { useConvexAuth } from "convex/react";
import { RequirementsList } from "./RequirementsList";
import { ClinicList } from "./ClinicList";
import { RotaView } from "./RotaView";
import { PharmacistList } from "./PharmacistList";
import Home from "./Home";
import { useEffect, useState } from "react";
import { AppHeader } from "./AppHeader";

export default function App() {
  const { isAuthenticated } = useConvexAuth();
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  } | null>(null);

  // Load the current user information from localStorage when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const storedUser = localStorage.getItem('currentPharmacist');
      if (storedUser) {
        try {
          setCurrentUser(JSON.parse(storedUser));
        } catch (e) {
          console.error("Error parsing user data:", e);
          // Clear invalid data
          localStorage.removeItem('currentPharmacist');
        }
      }
    } else {
      setCurrentUser(null);
      localStorage.removeItem('currentPharmacist');
    }
  }, [isAuthenticated]);

  // Handle sign out - clear user data
  const handleSignOut = () => {
    localStorage.removeItem('currentPharmacist');
    setCurrentUser(null);
  };

  return (
    <>
      {/* Always show the header with logout button when authenticated */}
      {isAuthenticated && (
        <AppHeader currentUser={currentUser} onSignOut={handleSignOut} />
      )}
      <main className="container mx-auto p-4 pt-16"> {/* Added top padding to account for fixed header */}
        <div className="min-h-screen">

        {!isAuthenticated ? (
          <SignInForm />
        ) : (
          <Home isAdmin={currentUser?.isAdmin ?? false} userEmail={currentUser?.email ?? ''} />
        )}
      </div>
    </main>
    </>
  );
}
