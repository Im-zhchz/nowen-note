export function splitSearchTerms(query: string): string[] {
  return Array.from(new Set((query || "").match(/[\p{Script=Han}]+|[^\s\p{Script=Han}]+/gu) || []));
}

export function hasHanText(query: string): boolean {
  return /\p{Script=Han}/u.test(query || "");
}

export function buildFtsSearchTerm(query: string): string {
  return splitSearchTerms(query)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" AND ");
}
