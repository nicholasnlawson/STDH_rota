import { SignInForm } from "./SignInForm";
import Home from "./Home";
import { useEffect, useState } from "react";
import { AppHeader } from "./AppHeader";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { RotaTypeSelector } from "./RotaTypeSelector";
import { TechnicianHome } from "./TechnicianHome";
import { PharmacistList } from "./PharmacistList";
import { RequirementsList } from "./RequirementsList";
import { ClinicList } from "./ClinicList";
import { RotaView } from "./RotaView";
import { AdminPage } from "./AdminPage";

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
    sessionToken?: string;
  } | null>(null);

  // Check for authentication by looking for user data in localStorage
  useEffect(() => {
    // Small delay to ensure consistent behavior
    const timer = setTimeout(() => {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const userData = JSON.parse(storedUser);
          console.log("Found user data in localStorage:", userData);
          
          if (userData && userData.id && userData.email) {
            setCurrentUser(userData);
            setIsAuthenticated(true);
            console.log("User is authenticated");
          } else {
            console.log("User data is incomplete");
            setIsAuthenticated(false);
            setCurrentUser(null);
          }
        } else {
          console.log("No user data found in localStorage");
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
      } catch (e) {
        console.error("Error checking authentication:", e);
        setIsAuthenticated(false);
        setCurrentUser(null);
      } finally {
        setIsLoading(false);
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Handle sign out - clear user data
  const handleSignOut = () => {
    localStorage.removeItem('user');
    setCurrentUser(null);
    setIsAuthenticated(false);
    console.log("User signed out");
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader onSignOut={handleSignOut} />
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <SignInForm />
          </div>
        </div>
      </div>
    );
  }

  // Show main app if authenticated
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader onSignOut={handleSignOut} />
      <main className="container mx-auto p-4 pt-16 flex-grow">
        <Routes>
          <Route 
            path="/" 
            element={
              currentUser?.isAdmin ? (
                <RotaTypeSelector />
              ) : (
                <Navigate to="/pharmacist" replace />
              )
            } 
          />
          <Route 
            path="/pharmacist/*" 
            element={
              <Home isAdmin={currentUser?.isAdmin ?? false} userEmail={currentUser?.email ?? ''} />
            } 
          />
          <Route 
            path="/technician" 
            element={
              <TechnicianHome isAdmin={currentUser?.isAdmin ?? false} userEmail={currentUser?.email ?? ''} />
            } 
          />
          {/* Admin Routes - only accessible to admins */}
          {currentUser?.isAdmin && (
            <>
              <Route 
                path="/pharmacists" 
                element={<PharmacistList />} 
              />
              <Route 
                path="/requirements" 
                element={
                  <div className="flex flex-col gap-8 w-full">
                    <ClinicList />
                    <RequirementsList />
                  </div>
                } 
              />
              <Route 
                path="/create-rota" 
                element={<RotaView isAdmin={true} />} 
              />
              <Route 
                path="/admin" 
                element={<AdminPage />} 
              />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
