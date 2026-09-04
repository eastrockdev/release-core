export function paginationFromRequest(
  request,
  { pageSize = 50, maxPageSize = 100 } = {},
) {
  const url = new URL(request.url);
  const rawPage = Number.parseInt(
    url.searchParams.get("page") || "1",
    10,
  );
  const rawPageSize = Number.parseInt(
    url.searchParams.get("pageSize") || String(pageSize),
    10,
  );

  const safePage =
    Number.isFinite(rawPage) && rawPage > 0
      ? rawPage
      : 1;
  const safePageSize = Math.min(
    maxPageSize,
    Math.max(
      1,
      Number.isFinite(rawPageSize)
        ? rawPageSize
        : pageSize,
    ),
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    skip: (safePage - 1) * safePageSize,
    take: safePageSize,
  };
}

export function paginationMeta({
  page,
  pageSize,
  total,
}) {
  const totalPages = Math.max(
    1,
    Math.ceil(total / pageSize),
  );

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}
