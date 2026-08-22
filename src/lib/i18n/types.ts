import type en from './en'

export type Locale = 'en' | 'et' | 'ru'
export const LOCALES: Locale[] = ['en', 'et', 'ru']

// en.ts is the canonical key structure (as const, so its own shape is
// exactly checked) — et.ts and ru.ts are typed against this widened version
// so a missing or extra key fails to compile, but a translated value isn't
// forced to match English's literal string.
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
export type Dictionary = Widen<typeof en>
