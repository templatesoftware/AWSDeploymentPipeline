/**
 * Get current date time path prefix
 */
export function getCurrentDateTimePrefix(): string {
    const now = new Date();
    const pad = (num: number) => num.toString().padStart(2, '0');

    const year = now.getFullYear();
    // Months are zero-based
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());

    return `${year}-${month}-${day}-${hours}-${minutes}`;
}