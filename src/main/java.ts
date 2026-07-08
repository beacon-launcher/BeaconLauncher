import { getPotentialJavaLocations, scanLocalJava } from '@xmcl/installer'

// Downloading a Java runtime happens in the installer utilityProcess (installer-worker.ts).
// The only Java bit that stays in the main process is detection — a quick local scan for a
// JDK the user already has installed, used by Settings → "Detect".

/** Settings "Detect" — find a Java of the given major already installed on the system. */
export async function detectJava(major: number): Promise<string | null> {
  try {
    const found = await scanLocalJava(await getPotentialJavaLocations())
    return found.find((j) => j.majorVersion === major)?.path ?? null
  } catch {
    return null
  }
}

/**
 * Scan the system once for every Java major the launcher can slot (8/17/21/25) and return a map of
 * major → path for the ones found. Used to auto-fill empty Java slots on first run so an existing
 * system JDK is preferred over downloading Mojang's runtime. One scan for all majors (the scan is
 * the expensive part), newest install of each major wins.
 */
export async function detectAllJava(majors: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {}
  try {
    const found = await scanLocalJava(await getPotentialJavaLocations())
    for (const major of majors) {
      const hit = found.find((j) => j.majorVersion === major)
      if (hit) out[major] = hit.path
    }
  } catch {
    /* detection is best-effort */
  }
  return out
}
