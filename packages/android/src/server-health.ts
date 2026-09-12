export async function checkHealth(url: string, username?: string, password?: string): Promise<boolean> {
  const base = url.replace(/\/+$/, "")
  const headers: HeadersInit = {}
  if (password) headers.Authorization = `Basic ${btoa(`${username || "opencode"}:${password}`)}`
  try {
    for (const path of ["/api/health", "/global/health", "/health"]) {
      const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(3000) })
      if (response.status === 404 || response.status === 405) continue
      if (!response.ok) return false
      // Older servers can serve the SPA at unknown API paths. Only a health object proves readiness.
      const body: unknown = await response.json().catch((error: unknown) => {
        if (error instanceof SyntaxError) return undefined
        throw error
      })
      if (body && typeof body === "object" && "healthy" in body) return body.healthy === true
    }
  } catch {
    // Authentication, transport and timeout failures must not be hidden by a legacy fallback.
  }
  return false
}
