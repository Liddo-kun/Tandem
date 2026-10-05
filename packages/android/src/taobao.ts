/** Match only the item-detail capability granted to the native opener. */
export function isTaobaoItemUrl(value: string) {
  const url = URL.parse(value)
  if (!url || url.protocol !== "taobao:" || url.hostname !== "item.taobao.com" || url.pathname !== "/item.htm") return false
  if (url.username || url.password || url.port || url.hash) return false
  const keys = [...url.searchParams.keys()]
  return keys.length === 1 && keys[0] === "id" && /^\d+$/.test(url.searchParams.get("id") ?? "")
}
