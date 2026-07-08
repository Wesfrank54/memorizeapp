/** Note field keys for bundled or hosted media URLs/paths. */
export const FIELD_FRONT_IMAGE = 'frontImage'
export const FIELD_BACK_IMAGE = 'backImage'

/**
 * Resolve a media path from note fields to a browser-loadable URL.
 * Relative paths (no protocol) are served from the Vite public folder.
 */
export function resolveMediaUrl(path: string | undefined): string | undefined {
  const t = path?.trim()
  if (!t) return undefined
  if (/^https?:\/\//i.test(t) || t.startsWith('data:') || t.startsWith('blob:')) return t
  return t.startsWith('/') ? t : `/${t}`
}

export function noteImageFields(fields: Record<string, string>): {
  frontImage?: string
  backImage?: string
} {
  return {
    frontImage: resolveMediaUrl(fields[FIELD_FRONT_IMAGE]),
    backImage: resolveMediaUrl(fields[FIELD_BACK_IMAGE]),
  }
}