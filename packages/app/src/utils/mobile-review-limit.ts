// Mobile webviews can stall or terminate when rendering very large review diffs.
export const MOBILE_REVIEW_FILE_LIMIT = 100

export function diffCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== "object") return 0
  return Object.keys(value).length
}

export function mobileReviewLimit(count: number, mobile: boolean, limit = MOBILE_REVIEW_FILE_LIMIT) {
  if (!mobile || count <= limit) return
  return { count, limit }
}
