import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

interface AdminLoginProps {
  onLoginSuccess?: () => void;
}

const AdminLogin = ({ onLoginSuccess }: AdminLoginProps) => {
  const [email, setEmail] = useState<string>("nicholas.lawson@nhs.net");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // We'll use a simple approach without calling Convex mutations
  // This avoids the JWT_PRIVATE_KEY issue

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // For now, we'll use a simple hardcoded admin check
      // In a real application, this would validate against a secure backend
      if (email === "nicholas.lawson@nhs.net" && password === "admin123") {
        // Create a mock user object
        const adminUser = {
          _id: "admin-user-id",
          email: email,
          name: "Nicholas Lawson",
          isAdmin: true,
        };
        
        // Store session info
        const sessionId = `admin-${Date.now()}`;
        localStorage.setItem("adminSession", sessionId);
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        
        // Call the success callback if provided
        if (onLoginSuccess) {
          onLoginSuccess();
        }
      } else {
        setError("Invalid credentials. The default password is 'admin123'.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      console.error("Login error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 py-12 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-sm">
        <h2 className="mt-10 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
          Admin Login
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Use the direct admin login below to access the system
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
        <form className="space-y-6" onSubmit={handleLogin}>
          <div>
            <label htmlFor="email" className="block text-sm font-medium leading-6 text-gray-900">
              Email address
            </label>
            <div className="mt-2">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 px-2"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium leading-6 text-gray-900">
                Password
              </label>
            </div>
            <div className="mt-2">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 px-2"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm mt-2">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-gray-500">Important Note</span>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            This is a direct admin login that bypasses the standard authentication.
            <br />
            The default password is "admin123" until you change it.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
