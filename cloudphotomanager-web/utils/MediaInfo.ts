export function formatCaptureDate(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return "";
  }
  return date.toLocaleString();
}

export function formatPlace(file: any): string {
  if (!file) {
    return "";
  }
  return [file.placeCity, file.placeRegion, file.placeCountry]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ");
}
