import { Client } from '@xhayper/discord-rpc'

// ─────────────────────────────────────────────────────────────────────────────
// Put the launcher's Discord Application (Client) ID here. Create an app at
// https://discord.com/developers/applications → copy the Application ID.
// Optionally upload a Rich Presence art asset named "beacon" for the icon.
const CLIENT_ID = '1523515036180549833'
// ─────────────────────────────────────────────────────────────────────────────

export interface Activity {
  details: string
  state?: string
  // A public image URL (e.g. the player's head) to show as the big presence image. Modern Discord
  // clients resolve raw URLs for large/small image keys; when absent we fall back to the app logo.
  imageUrl?: string
  imageText?: string
}

let client: Client | null = null
let ready = false
let enabled = true
let current: Activity = { details: 'Idling' }
let startedAt = Date.now()

function pushActivity(): void {
  if (!client || !ready || !enabled) return
  const base = { details: current.details, state: current.state, startTimestamp: startedAt }
  const logo = { largeImageKey: 'beacon', largeImageText: 'Beacon' as string }
  if (!current.imageUrl) {
    client.user?.setActivity({ ...base, ...logo }).catch(() => {})
    return
  }
  // Show the player's head large with the Beacon logo as a small corner badge. Raw image URLs work
  // on current Discord clients but not older ones — if the URL is rejected, retry with just the app
  // asset so the "Playing <profile>" line still shows instead of losing the presence entirely.
  client.user
    ?.setActivity({
      ...base,
      largeImageKey: current.imageUrl,
      largeImageText: current.imageText || 'Beacon',
      smallImageKey: 'beacon',
      smallImageText: 'Beacon'
    })
    .catch(() => {
      client?.user?.setActivity({ ...base, ...logo }).catch(() => {})
    })
}

async function connect(): Promise<void> {
  if (!CLIENT_ID || client) return
  const c = new Client({ clientId: CLIENT_ID })
  c.on('ready', () => {
    ready = true
    pushActivity()
  })
  client = c
  try {
    await c.login()
    ready = true
    pushActivity()
  } catch {
    // Discord isn't running / not installed — stay silent.
    client = null
    ready = false
  }
}

export function setActivity(a: Activity): void {
  // Reset the elapsed timer on a real change so "Playing <profile>" counts the play session
  // and "Idling" counts idle time.
  if (a.details !== current.details || a.state !== current.state) startedAt = Date.now()
  current = a
  if (enabled) void connect().then(pushActivity)
}

export function setEnabled(v: boolean): void {
  enabled = v
  if (v) void connect().then(pushActivity)
  else client?.user?.clearActivity().catch(() => {})
}
