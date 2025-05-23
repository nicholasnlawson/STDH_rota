// Generate a consistent color based on a string input (technician ID)
export const getTechnicianColor = (id: string) => {
  // Simple hash function to convert string to a number
  const hash = id.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  
  // Generate HSL color with fixed saturation and lightness for good visibility
  const hue = Math.abs(hash) % 360; // 0-359
  const saturation = 70 + Math.abs(hash % 30); // 70-100%
  const lightness = 40 + Math.abs(hash % 30); // 40-70%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Utility to get text color that contrasts well with the background
export const getContrastColor = (bgColor: string) => {
  // For HSL, we can use the lightness value to determine contrast
  const lightness = parseInt(bgColor.split(',')[2]);
  return lightness > 60 ? '#000000' : '#FFFFFF';
};
