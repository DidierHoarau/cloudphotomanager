import { PAGINATION_PAGE_SIZE_MAX, PaginationParse } from "./Pagination";

describe("PaginationParse", () => {
  it("returns defaults for missing or empty parameters", () => {
    expect(PaginationParse({})).toEqual({ page: 0, pageSize: 60 });
    expect(PaginationParse({ page: "", pageSize: "" })).toEqual({
      page: 0,
      pageSize: 60,
    });
    expect(PaginationParse({ page: "2" })).toEqual({ page: 2, pageSize: 60 });
    expect(PaginationParse({ pageSize: "10" })).toEqual({
      page: 0,
      pageSize: 10,
    });
  });

  it("accepts valid integer values", () => {
    expect(PaginationParse({ page: "0", pageSize: "1" })).toEqual({
      page: 0,
      pageSize: 1,
    });
    expect(
      PaginationParse({ page: "12", pageSize: String(PAGINATION_PAGE_SIZE_MAX) }),
    ).toEqual({ page: 12, pageSize: 200 });
  });

  it("rejects non-numeric and non-integer values", () => {
    expect(PaginationParse({ page: "abc" })).toBeNull();
    expect(PaginationParse({ pageSize: "abc" })).toBeNull();
    expect(PaginationParse({ page: "1.5" })).toBeNull();
    expect(PaginationParse({ pageSize: "1.5" })).toBeNull();
    expect(PaginationParse({ page: "1e2" })).toBeNull();
    expect(PaginationParse({ page: " 1 " })).toBeNull();
  });

  it("rejects negative values", () => {
    expect(PaginationParse({ page: "-1" })).toBeNull();
    expect(PaginationParse({ pageSize: "-1" })).toBeNull();
  });

  it("rejects pageSize 0 and values above the cap", () => {
    expect(PaginationParse({ pageSize: "0" })).toBeNull();
    expect(PaginationParse({ pageSize: "201" })).toBeNull();
    expect(PaginationParse({ pageSize: "100000" })).toBeNull();
  });

  it("rejects values beyond the safe integer range", () => {
    expect(PaginationParse({ page: "99999999999999999999" })).toBeNull();
    expect(PaginationParse({ pageSize: "99999999999999999999" })).toBeNull();
  });

  it("honors a custom default page size", () => {
    expect(PaginationParse({}, 50)).toEqual({ page: 0, pageSize: 50 });
  });
});
