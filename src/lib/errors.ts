/**
 * Normalizes any thrown/rejected value into a displayable UI message.
 *
 * Replaces the `(e as Error).message` casts that were scattered across
 * `App.tsx`'s catch blocks — that cast lies whenever the rejection isn't
 * actually an `Error` (a string throw, a plain object, `undefined`), which
 * TypeScript's `catch (e)` typed as `unknown` cannot prevent at compile
 * time. Never returns `undefined`/empty: an unrecognized shape still
 * produces a generic-but-honest message rather than `"undefined"` or a
 * blank error banner.
 */
export function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erreur inconnue.";
}
