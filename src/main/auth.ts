// Microsoft ("licensed") sign-in for Minecraft: Java Edition.
//
// Interactive OAuth *authorization-code* flow with PKCE — the user signs in through a real
// Microsoft login window (an Electron BrowserWindow), exactly like the official launcher and
// Prism. No embedded credentials, no client secret; the Azure app below is a public client the
// launcher owns (its client id is public by design). Offline play is untouched.
//
// Chain: Microsoft OAuth  →  Xbox Live (XBL)  →  XSTS  →  Minecraft services  →  profile.

import { BrowserWindow } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import type { Account } from './store'

// Public client id of the launcher's Azure "app registration" (personal Microsoft accounts,
// scope XboxLive.signin). Not a secret — it only identifies the app to Microsoft.
const CLIENT_ID = 'e071758d-7d90-4176-9bb4-76945006f3eb'
const SCOPE = 'XboxLive.signin offline_access'
// "consumers" tenant = personal Microsoft accounts, which is what owns Minecraft.
const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
// Standard "native client" redirect for desktop apps: after login the browser lands on this
// blank page with ?code=... in the URL, which we intercept. Must be registered on the Azure app
// under Authentication → Mobile and desktop applications.
const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

// ── small fetch helpers ──────────────────────────────────────────────────────
async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString()
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status} ${JSON.stringify(json)}`)
  return json
}

// ── PKCE ──────────────────────────────────────────────────────────────────────
const base64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// ── interactive login window ──────────────────────────────────────────────────
/**
 * Open the Microsoft login popup and resolve with the authorization code once the user signs in.
 * Rejects with 'cancelled' if they close the window first.
 */
function getAuthCode(parent: BrowserWindow | null, challenge: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT,
    response_mode: 'query',
    scope: SCOPE,
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  const authUrl = `${OAUTH}/authorize?${params.toString()}`

  return new Promise<string>((resolve, reject) => {
    const popup = new BrowserWindow({
      width: 500,
      height: 660,
      parent: parent ?? undefined,
      modal: !!parent,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })

    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
      if (!popup.isDestroyed()) popup.close()
    }

    // The redirect target carries either ?code=... (success) or ?error=... (denied).
    const inspect = (url: string): void => {
      if (!url.startsWith(REDIRECT)) return
      const q = new URL(url).searchParams
      const code = q.get('code')
      const error = q.get('error')
      if (code) finish(() => resolve(code))
      else if (error) finish(() => reject(new Error(q.get('error_description') || error)))
    }

    popup.webContents.on('will-redirect', (_e, url) => inspect(url))
    popup.webContents.on('will-navigate', (_e, url) => inspect(url))
    popup.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('cancelled'))
      }
    })
    popup.loadURL(authUrl)
  })
}

/** Exchange the authorization code for OAuth tokens (public client + PKCE, no secret). */
async function exchangeCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { ok, json } = await postForm(`${OAUTH}/token`, {
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    scope: SCOPE,
    code_verifier: verifier
  })
  if (!ok || !json.access_token) throw new Error(json.error_description || json.error || 'Sign-in failed.')
  return { accessToken: json.access_token, refreshToken: json.refresh_token }
}

/** Exchange a stored refresh token for a fresh Microsoft access token (silent re-auth). */
async function refreshMsToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { ok, json } = await postForm(`${OAUTH}/token`, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    scope: SCOPE,
    refresh_token: refreshToken
  })
  if (!ok || !json.access_token) throw new Error(json.error_description || json.error || 'Session expired — please sign in again.')
  // Microsoft rotates refresh tokens; keep the new one if present, else reuse the old.
  return { accessToken: json.access_token, refreshToken: json.refresh_token || refreshToken }
}

// ── Xbox Live / XSTS / Minecraft ──────────────────────────────────────────────
async function xblAuth(msAccessToken: string): Promise<{ token: string; uhs: string }> {
  const j = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })
  return { token: j.Token, uhs: j.DisplayClaims.xui[0].uhs }
}

async function xstsAuth(xblToken: string): Promise<{ token: string; uhs: string }> {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    // XSTS uses specific error codes for accounts that can't reach Minecraft services.
    const xerr = (j as { XErr?: number }).XErr
    if (xerr === 2148916233) throw new Error('This Microsoft account has no Xbox profile — create one at xbox.com first.')
    if (xerr === 2148916235) throw new Error('Xbox Live is not available in this account’s region.')
    if (xerr === 2148916236 || xerr === 2148916237) throw new Error('This account needs adult verification on xbox.com.')
    if (xerr === 2148916238) throw new Error('This account is a child account — add it to a Family group first.')
    throw new Error(`Xbox sign-in failed (HTTP ${res.status}${xerr ? `, XErr ${xerr}` : ''}).`)
  }
  return { token: (j as any).Token, uhs: (j as any).DisplayClaims.xui[0].uhs }
}

async function minecraftLogin(uhs: string, xstsToken: string): Promise<{ token: string; expiresAt: number }> {
  const j = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  })
  return { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 86400) * 1000 }
}

async function minecraftProfile(mcToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { authorization: `Bearer ${mcToken}`, accept: 'application/json' }
  })
  if (res.status === 404) throw new Error('This Microsoft account does not own Minecraft: Java Edition.')
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !(j as { id?: string }).id) throw new Error(`Could not read Minecraft profile (HTTP ${res.status}).`)
  return { id: (j as any).id, name: (j as any).name }
}

/** Given a valid Microsoft access token, walk the whole chain down to a ready Account. */
async function accountFromMsToken(ms: { accessToken: string; refreshToken: string }): Promise<Account> {
  const xbl = await xblAuth(ms.accessToken)
  const xsts = await xstsAuth(xbl.token)
  const mc = await minecraftLogin(xsts.uhs, xsts.token)
  const profile = await minecraftProfile(mc.token)
  return { id: profile.id, name: profile.name, type: 'msa', msRefresh: ms.refreshToken, mcToken: mc.token, mcExpiresAt: mc.expiresAt }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Run the interactive popup sign-in and resolve to a fully-formed Account. */
export async function signIn(parent: BrowserWindow | null): Promise<Account> {
  const { verifier, challenge } = pkce()
  const code = await getAuthCode(parent, challenge)
  const tokens = await exchangeCode(code, verifier)
  return accountFromMsToken(tokens)
}

/**
 * Return a launch-ready account: reuses the cached Minecraft token while it's still valid,
 * otherwise silently refreshes the whole chain. Throws if the session can't be renewed
 * (revoked / expired) — the caller should then prompt a fresh sign-in.
 */
export async function ensureValid(account: Account): Promise<Account> {
  // 60s safety margin so the token doesn't expire mid-launch.
  if (account.mcToken && account.mcExpiresAt && account.mcExpiresAt - 60_000 > Date.now()) return account
  if (!account.msRefresh) throw new Error('Session expired — please sign in again.')
  const ms = await refreshMsToken(account.msRefresh)
  const fresh = await accountFromMsToken(ms)
  return { ...fresh, id: account.id } // keep the original UUID as the stable key
}
