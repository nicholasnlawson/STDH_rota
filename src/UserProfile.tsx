import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { toast } from "sonner";

// Type for NotAvailableRule
type NotAvailableRule = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
};

// Props for the UserProfile component
interface UserProfileProps {
  pharmacist: {
    _id: Id<"pharmacists">;
    name: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    email: string;
    band: string;
    primaryDirectorate: string;
    warfarinTrained: boolean;
    ituTrained: boolean;
    specialistTraining?: string[];
    isDefaultPharmacist: boolean;
    preferences: string[];
    availability: string[];
    isAdmin: boolean;
    trainedDirectorates: string[];
    primaryWards: string[];
    workingDays: string[];
    notAvailableRules?: NotAvailableRule[];
  };
}

export function UserProfile({ pharmacist }: UserProfileProps) {
  // Get the update mutation and required data
  const updatePharmacist = useMutation(api.pharmacists.update);
  const changePassword = useMutation(api.auth.changePassword);
  const directorates = useQuery(api.requirements.listDirectorates) || [];
  
  // Fetch all unique special training types from directorates
  const allSpecialTrainingTypes = Array.from(new Set(
    directorates.flatMap(d => d.specialTrainingTypes || ["ITU"])
  ));
  
  // Get all wards with directorate info for selection
  const allWards = directorates.flatMap((d: any) => (d.wards || []).filter((w: any) => w.isActive).map((w: any) => ({...w, directorate: d.name})));
  
  // State for editing mode
  const [isEditing, setIsEditing] = useState(false);
  
  // State for password management
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  
  const [editFormData, setEditFormData] = useState({
    ...pharmacist,
    firstName: pharmacist.firstName || "",
    lastName: pharmacist.lastName || "",
    displayName: pharmacist.displayName || pharmacist.name,
    workingDays: Array.isArray(pharmacist.workingDays) ? pharmacist.workingDays : [],
    notAvailableRules: Array.isArray(pharmacist.notAvailableRules) ? pharmacist.notAvailableRules : [],
    specialistTraining: Array.isArray(pharmacist.specialistTraining) ? pharmacist.specialistTraining : [],
  });

  // Handle changes to the form
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditFormData({
      ...editFormData,
      [name]: value,
    });
  };

  // Handle checkbox changes
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setEditFormData({
      ...editFormData,
      [name]: checked,
    });
  };

  // Handle working day toggles
  const handleWorkingDayToggle = (day: string) => {
    setEditFormData(prev => {
      const workingDays = [...prev.workingDays];
      if (workingDays.includes(day)) {
        return { ...prev, workingDays: workingDays.filter(d => d !== day) };
      } else {
        return { ...prev, workingDays: [...workingDays, day] };
      }
    });
  };

  // Handle specialist training selection
  const handleSpecialistTrainingToggle = (training: string) => {
    setEditFormData(prev => {
      const specialistTraining = [...(prev.specialistTraining || [])];
      if (specialistTraining.includes(training)) {
        return { ...prev, specialistTraining: specialistTraining.filter(t => t !== training) };
      } else {
        return { ...prev, specialistTraining: [...specialistTraining, training] };
      }
    });
  };
  
  // Handle trained directorates selection
  const handleDirectorateToggle = (directorate: string) => {
    setEditFormData(prev => {
      const trainedDirectorates = [...prev.trainedDirectorates];
      if (trainedDirectorates.includes(directorate)) {
        return { ...prev, trainedDirectorates: trainedDirectorates.filter(d => d !== directorate) };
      } else {
        return { ...prev, trainedDirectorates: [...trainedDirectorates, directorate] };
      }
    });
  };
  
  // Handle primary wards selection
  const handlePrimaryWardToggle = (ward: string) => {
    setEditFormData(prev => {
      const primaryWards = [...prev.primaryWards];
      if (primaryWards.includes(ward)) {
        return { ...prev, primaryWards: primaryWards.filter(w => w !== ward) };
      } else {
        return { ...prev, primaryWards: [...primaryWards, ward] };
      }
    });
  };
  
  // Handle adding a not available rule
  const [newRule, setNewRule] = useState({ dayOfWeek: "Monday", startTime: "09:00", endTime: "17:00" });
  
  const handleAddNotAvailableRule = () => {
    if (newRule.startTime >= newRule.endTime) {
      toast.error("End time must be after start time");
      return;
    }
    
    setEditFormData(prev => {
      const notAvailableRules = [...(prev.notAvailableRules || [])];
      return {
        ...prev,
        notAvailableRules: [...notAvailableRules, { ...newRule }]
      };
    });
    
    // Reset the form for the next rule
    setNewRule({ dayOfWeek: "Monday", startTime: "09:00", endTime: "17:00" });
  };
  
  // Handle removing a not available rule
  const handleRemoveNotAvailableRule = (index: number) => {
    setEditFormData(prev => {
      const notAvailableRules = [...(prev.notAvailableRules || [])];
      notAvailableRules.splice(index, 1);
      return { ...prev, notAvailableRules };
    });
  };
  
  // Handle password change input
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordData(prevData => ({
      ...prevData,
      [name]: value
    }));
  };

  // Handle password update submission
  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    
    // Simple validation
    if (!passwordData.currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    
    if (passwordData.newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    
    try {
      // Get the current user from localStorage
      const userData = localStorage.getItem('user');
      if (!userData) {
        setPasswordError("You must be logged in to change your password");
        return;
      }
      
      const user = JSON.parse(userData);
      
      // Call the change password mutation
      await changePassword({
        email: user.email,
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      
      // If we get here, the password was updated successfully
      setPasswordSuccess("Password updated successfully");
      
      // Reset form
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      });
      
      // Update the user data in localStorage with the new password
      // (we don't store the password in localStorage, but this keeps the timestamp updated)
      const updatedUserData = {
        ...user,
        sessionToken: `${Date.now()}_${user.id}_${Math.random().toString(36).substring(2, 15)}`
      };
      localStorage.setItem('user', JSON.stringify(updatedUserData));
    } catch (error) {
      console.error("Error updating password:", error);
      setPasswordError("Failed to update password");
    }
  };

  // Function to handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // If firstName/lastName are provided but displayName is not, 
      // generate a default displayName
      let formDataToSubmit = { ...editFormData };
      
      if (formDataToSubmit.firstName && formDataToSubmit.lastName && !formDataToSubmit.displayName) {
        formDataToSubmit.displayName = `${formDataToSubmit.firstName} ${formDataToSubmit.lastName.charAt(0)}.`;
      } else if (!formDataToSubmit.displayName) {
        formDataToSubmit.displayName = formDataToSubmit.name;
      }
      
      // IMPORTANT: Create a clean object without any internal Convex fields
      // Only include the fields that are expected by the schema
      await updatePharmacist({
        id: pharmacist._id,
        name: formDataToSubmit.name,
        firstName: formDataToSubmit.firstName,
        lastName: formDataToSubmit.lastName,
        displayName: formDataToSubmit.displayName,
        email: formDataToSubmit.email,
        band: formDataToSubmit.band,
        primaryDirectorate: formDataToSubmit.primaryDirectorate,
        warfarinTrained: formDataToSubmit.warfarinTrained,
        // These fields should not be changeable by the user
        isAdmin: pharmacist.isAdmin,
        isDefaultPharmacist: pharmacist.isDefaultPharmacist,
        ituTrained: pharmacist.ituTrained,
        preferences: formDataToSubmit.preferences || [],
        availability: formDataToSubmit.availability || [],
        trainedDirectorates: formDataToSubmit.trainedDirectorates || [],
        primaryWards: formDataToSubmit.primaryWards || [],
        workingDays: formDataToSubmit.workingDays || [],
        specialistTraining: formDataToSubmit.specialistTraining || [],
        notAvailableRules: formDataToSubmit.notAvailableRules || []
      });
      
      // Exit edit mode
      setIsEditing(false);
      toast.success("Profile updated successfully");
      
      // Update local storage to reflect any name changes
      const storedUser = localStorage.getItem('currentPharmacist');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        userData.name = formDataToSubmit.displayName || formDataToSubmit.name;
        localStorage.setItem('currentPharmacist', JSON.stringify(userData));
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Error updating profile");
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold">My Profile</h2>
        {!isEditing ? (
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setShowPasswordForm(!showPasswordForm)}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition"
            >
              {showPasswordForm ? 'Hide Password Form' : 'Change Password'}
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Edit Profile
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Save Changes
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-1">First Name</label>
              <input
                type="text"
                name="firstName"
                value={editFormData.firstName}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name</label>
              <input
                type="text"
                name="lastName"
                value={editFormData.lastName}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Display Name (Appears in rota as)</label>
              <input
                type="text"
                name="displayName"
                value={editFormData.displayName}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. John S."
              />
              <p className="mt-1 text-xs text-gray-500">
                How your name appears in the rota. If left blank, it will be generated as "FirstName L."
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Full Name</label>
              <input
                type="text"
                name="name"
                value={editFormData.name}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Will be populated automatically from First and Last Name if left blank.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                name="email"
                value={editFormData.email}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Band</label>
              <select
                name="band"
                value={editFormData.band}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8a">8a</option>
                <option value="8b">8b</option>
                <option value="8c">8c</option>
                <option value="8d">8d</option>
                <option value="9">9</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Primary Directorate</label>
              <select
                name="primaryDirectorate"
                value={editFormData.primaryDirectorate}
                onChange={handleChange}
                className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Select Directorate --</option>
                {directorates.map((directorate: any) => (
                  <option key={directorate._id} value={directorate.name}>
                    {directorate.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Working Days */}
          <div>
            <label className="block text-sm font-medium mb-1">Working Days</label>
            <div className="flex flex-wrap gap-2">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleWorkingDayToggle(day)}
                  className={`px-3 py-1 rounded-full text-sm ${
                    editFormData.workingDays.includes(day)
                      ? 'bg-blue-100 text-blue-800 border border-blue-300'
                      : 'bg-gray-100 text-gray-600 border border-gray-300'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          
          {/* Trained Directorates */}
          <div>
            <label className="block text-sm font-medium mb-1">Trained Directorates</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {directorates.map((directorate: any) => (
                <div key={directorate._id} className="flex items-center">
                  <input
                    type="checkbox"
                    id={`dir-${directorate._id}`}
                    checked={editFormData.trainedDirectorates.includes(directorate.name)}
                    onChange={() => handleDirectorateToggle(directorate.name)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <label htmlFor={`dir-${directorate._id}`} className="ml-2 text-sm">
                    {directorate.name}
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Primary Wards */}
          <div>
            <label className="block text-sm font-medium mb-1">Primary Wards</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {allWards.map((ward: any) => (
                <div key={ward.name} className="flex items-center">
                  <input
                    type="checkbox"
                    id={`ward-${ward.name}`}
                    checked={editFormData.primaryWards.includes(ward.name)}
                    onChange={() => handlePrimaryWardToggle(ward.name)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <label htmlFor={`ward-${ward.name}`} className="ml-2 text-sm">
                    {ward.name} ({ward.directorate})
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Special Training */}
          <div>
            <label className="block text-sm font-medium mb-1">Special Training</label>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {/* Warfarin Training */}
              <div className="flex items-center mr-4">
                <input
                  type="checkbox"
                  id="warfarin-trained"
                  name="warfarinTrained"
                  checked={editFormData.warfarinTrained}
                  onChange={handleCheckboxChange}
                  className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                />
                <label htmlFor="warfarin-trained" className="ml-2 text-sm">
                  Warfarin Trained
                </label>
              </div>
              
              {/* ITU Training (display only) */}
              {pharmacist.ituTrained && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    className="rounded border-gray-300 text-green-600 shadow-sm"
                  />
                  <label className="ml-2 text-sm text-gray-600">
                    ITU Trained (cannot be changed)
                  </label>
                </div>
              )}
            </div>
          </div>
          
          {/* Specialist Training */}
          <div>
            <label className="block text-sm font-medium mb-1">Specialist Training</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
              {allSpecialTrainingTypes.map((training: string) => (
                <div key={training} className="flex items-center">
                  <input
                    type="checkbox"
                    id={`training-${training}`}
                    checked={(editFormData.specialistTraining || []).includes(training)}
                    onChange={() => handleSpecialistTrainingToggle(training)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <label htmlFor={`training-${training}`} className="ml-2 text-sm">
                    {training}
                  </label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Not Available Rules */}
          <div className="border-t pt-4">
            <h3 className="text-md font-medium mb-2">Unavailability Rules</h3>
            
            {/* Current rules */}
            {(editFormData.notAvailableRules || []).length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium mb-2">Current Rules</h4>
                <div className="space-y-2">
                  {(editFormData.notAvailableRules || []).map((rule, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="text-sm">
                        {rule.dayOfWeek} {rule.startTime} - {rule.endTime}
                      </div>
                      <button 
                        type="button"
                        onClick={() => handleRemoveNotAvailableRule(index)}
                        className="text-red-600 hover:text-red-800 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Add new rule */}
            <div className="bg-gray-50 p-3 rounded">
              <h4 className="text-sm font-medium mb-2">Add Not Available Rule</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-700 mb-1">Day</label>
                  <select
                    value={newRule.dayOfWeek}
                    onChange={(e) => setNewRule({...newRule, dayOfWeek: e.target.value})}
                    className="w-full text-sm rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">Start Time</label>
                  <select
                    value={newRule.startTime}
                    onChange={(e) => setNewRule({...newRule, startTime: e.target.value})}
                    className="w-full text-sm rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"].map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">End Time</label>
                  <select
                    value={newRule.endTime}
                    onChange={(e) => setNewRule({...newRule, endTime: e.target.value})}
                    className="w-full text-sm rounded border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"].map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddNotAvailableRule}
                className="mt-3 bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
              >
                Add Rule
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Full Name</h3>
              <p className="mt-1">{pharmacist.firstName} {pharmacist.lastName}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Display Name</h3>
              <p className="mt-1">{pharmacist.displayName || pharmacist.name}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Email</h3>
              <p className="mt-1">{pharmacist.email}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Band</h3>
              <p className="mt-1">{pharmacist.band}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Primary Directorate</h3>
              <p className="mt-1">{pharmacist.primaryDirectorate}</p>
            </div>
            {pharmacist.warfarinTrained && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Special Training</h3>
                <div className="mt-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Warfarin Trained
                  </span>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-medium text-gray-500">Working Days</h3>
              <div className="mt-1 flex flex-wrap gap-1">
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => (
                  <span
                    key={day}
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      pharmacist.workingDays && pharmacist.workingDays.includes(day)
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {day}
                  </span>
                ))}
              </div>
            </div>
          </div>
          
          {pharmacist.primaryWards.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Primary Wards</h3>
              <div className="flex flex-wrap gap-1">
                {pharmacist.primaryWards.map(ward => (
                  <span key={ward} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                    {ward}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {pharmacist.trainedDirectorates.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Trained Directorates</h3>
              <div className="flex flex-wrap gap-1">
                {pharmacist.trainedDirectorates.map(directorate => (
                  <span key={directorate} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                    {directorate}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {pharmacist.specialistTraining && pharmacist.specialistTraining.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Specialist Training</h3>
              <div className="flex flex-wrap gap-1">
                {pharmacist.specialistTraining.map(training => (
                  <span key={training} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    {training}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Password Change Form in View Mode */}
          {showPasswordForm && (
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Change Password</h3>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
                    Current Password
                  </label>
                  <input
                    type="password"
                    id="currentPassword"
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                    New Password
                  </label>
                  <input
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    required
                    minLength={8}
                  />
                </div>
                
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    required
                  />
                </div>
                
                {passwordError && (
                  <div className="text-sm text-red-600">{passwordError}</div>
                )}
                
                {passwordSuccess && (
                  <div className="text-sm text-green-600">{passwordSuccess}</div>
                )}
                
                <div className="flex justify-between">
                  <button
                    type="submit"
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Update Password
                  </button>
                  <div className="text-sm text-gray-500 mt-1">
                    Update your password here. Please make sure your new password is at least 8 characters long.
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
