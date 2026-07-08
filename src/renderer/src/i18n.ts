import en from './locales/en.json'
import ru from './locales/ru.json'

export type Language = 'en' | 'ru'

const translations: Record<Language, Record<string, string>> = { en, ru }

let current: Language = 'en'

export const t = (key: string): string => translations[current][key] ?? key
export const setLanguage = (lang: Language): void => { current = lang }
export const getLanguage = (): Language => current
