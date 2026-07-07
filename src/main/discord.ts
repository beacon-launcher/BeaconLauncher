import { Client } from '@xhayper/discord-rpc'

// ─────────────────────────────────────────────────────────────────────────────
// Put the launcher's Discord Application (Client) ID here. Create an app at
// https://discord.com/developers/applications → copy the Application ID.
// Optionally upload a Rich Presence art asset named "beacon" for the icon.
const CLIENT_ID = '1523515036180549833'
// ─────────────────────────────────────────────────────────────────────────────

let client: Client | null = null
let ready = false
let enabled = true
let current: { details: string; state?: string } = { details: 'Idling' }
let startedAt = Date.now()

function pushActivity(): void {
  if (!client || !ready || !enabled) return
  client.user
    ?.setActivity({
      details: current.details,
      state: current.state,
      startTimestamp: startedAt,
      largeImageKey: 'beacon',
      largeImageText: 'Beacon'
    })
    .catch(() => {})
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

export function setActivity(a: { details: string; state?: string }): void {
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
