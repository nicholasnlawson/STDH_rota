/**
 * Format a date string as a readable date
 * @param dateStr Date string in ISO format (YYYY-MM-DD)
 * @returns Formatted date string
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  return date.toLocaleDateString('en-GB', { 
    weekday: 'short',
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
}
