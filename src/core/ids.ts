/** UUID v4. Works in modern browsers and Node alike. */
export function newId(): string {
  return crypto.randomUUID()
}

const DEVICE_KEY = 'memorize-device-id'

/** Stable per-browser/device ID. Used for review_log.device_id in production sync. */
export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'server'
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = newId()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}
