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
