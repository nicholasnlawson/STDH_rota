import { SignInForm } from "./SignInForm";
import { SignOutButton } from "./SignOutButton";
import { useConvexAuth } from "convex/react";
import { RequirementsList } from "./RequirementsList";
import { ClinicList } from "./ClinicList";
import { RotaView } from "./RotaView";
import { PharmacistList } from "./PharmacistList";
import Home from "./Home";

export default function App() {
  const { isAuthenticated } = useConvexAuth();

  return (
    <main className="container mx-auto p-4">
      <div className="min-h-screen">
        <div className="flex justify-between items-center mb-8">
          {/* Remove duplicate heading here */}
          {/* <h1 className="text-3xl font-bold">Pharmacy Rota Management</h1> */}
          <div>
            {isAuthenticated ? <SignOutButton /> : null}
          </div>
        </div>

        {!isAuthenticated ? (
          <SignInForm />
        ) : (
          <Home />
        )}
      </div>
    </main>
  );
}
