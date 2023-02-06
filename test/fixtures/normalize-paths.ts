export const normalizePath = (
  path: string,
  replace: { [k: string]: string } = {}
) => {
  for (const [search, repl] of Object.entries(replace)) {
    path = path.split(search).join(repl)
  }
  return path.replace(/[A-Z]:/, '').replace(/\\/g, '/')
}

export const normalizePaths = (
  obj: any,
  replace: { [k: string]: string } = {}
): typeof obj => {
  if (
    !obj ||
    typeof obj === 'number' ||
    typeof obj === 'symbol' ||
    typeof obj === 'boolean' ||
    obj instanceof RegExp ||
    typeof obj === 'function'
  ) {
    return obj
  }

  if (typeof obj === 'string') {
    return normalizePath(obj, replace)
  }

  if (obj instanceof Set) {
    return new Set(normalizePaths([...obj], replace))
  }

  if (Array.isArray(obj)) {
    return obj.map(v => normalizePaths(v, replace))
  }

  if (obj instanceof Map) {
    return new Map(
      [...obj].map(([name, val]) => [name, normalizePaths(val, replace)])
    )
  }

  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      normalizePaths(k, replace),
      normalizePaths(v, replace),
    ])
  )
}
