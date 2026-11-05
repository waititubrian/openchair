/** URL builders for the public booking flow, so the pages never hand-assemble query strings. */
export function servicePath(slug: string, serviceId: string, q: { staff?: string; from?: string; date?: string } = {}): string {
  const params = new URLSearchParams();
  if (q.staff && q.staff !== "any") params.set("staff", q.staff);
  if (q.from) params.set("from", q.from);
  if (q.date) params.set("date", q.date);
  const qs = params.toString();
  return `/b/${slug}/${serviceId}${qs ? `?${qs}` : ""}`;
}

export function detailsPath(slug: string, serviceId: string, staff: string, startsAtIso: string): string {
  const params = new URLSearchParams({ start: startsAtIso });
  if (staff !== "any") params.set("staff", staff);
  return `/b/${slug}/${serviceId}/details?${params.toString()}`;
}

export function confirmationPath(slug: string, token: string): string {
  return `/b/${slug}/confirmation/${token}`;
}
