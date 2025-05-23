import { useNavigate } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";

export function RotaTypeSelector() {
  const navigate = useNavigate();
  const { user } = useAuth0();

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold text-center mb-2">
        Welcome, {user?.name || 'User'}
      </h1>
      <h2 className="text-xl text-center text-gray-600 mb-8">
        Please select a rota type to manage:
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pharmacist Rota Card */}
        <div 
          className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 border border-gray-200 flex flex-col h-full"
        >
          <div className="p-6 flex-grow flex flex-col">
            <h3 className="text-xl font-semibold mb-3 text-center">
              Pharmacist Rota
            </h3>
            <p className="text-gray-600 mb-6 flex-grow">
              Manage pharmacist schedules, shifts, and assignments.
            </p>
            <button 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors duration-200"
              onClick={() => navigate('/pharmacist')}
            >
              Manage Pharmacist Rota
            </button>
          </div>
        </div>
        
        {/* Technician Rota Card */}
        <div 
          className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 border border-gray-200 flex flex-col h-full"
        >
          <div className="p-6 flex-grow flex flex-col">
            <h3 className="text-xl font-semibold mb-3 text-center">
              Pharmacy Technician Rota
            </h3>
            <p className="text-gray-600 mb-6 flex-grow">
              Manage pharmacy technician schedules, shifts, and duties.
            </p>
            <button 
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded transition-colors duration-200"
              onClick={() => navigate('/technician')}
            >
              Manage Technician Rota
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
