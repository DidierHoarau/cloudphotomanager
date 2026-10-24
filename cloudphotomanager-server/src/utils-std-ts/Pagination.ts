export const PAGINATION_PAGE_SIZE_MAX = 200;
export const PAGINATION_PAGE_SIZE_DEFAULT = 60;

// Parses the page/pageSize query parameters. Missing or empty values fall back
// to the defaults; non-integers and out-of-range values return null so routes
// can answer 400 (a negative pageSize must never reach LIMIT -1).
export function PaginationParse(
  query: { page?: string; pageSize?: string },
  defaultPageSize = PAGINATION_PAGE_SIZE_DEFAULT,
): { page: number; pageSize: number } | null {
  const pageRaw =
    query.page === undefined || query.page === "" ? "0" : query.page;
  const pageSizeRaw =
    query.pageSize === undefined || query.pageSize === ""
      ? String(defaultPageSize)
      : query.pageSize;
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(pageSizeRaw)) {
    return null;
  }
  const page = Number(pageRaw);
  const pageSize = Number(pageSizeRaw);
  if (!Number.isSafeInteger(page)) {
    return null;
  }
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PAGINATION_PAGE_SIZE_MAX
  ) {
    return null;
  }
  return { page, pageSize };
}
