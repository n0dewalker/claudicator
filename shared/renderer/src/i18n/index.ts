import { ja } from '@app/i18n/ja'
import { en } from '@app/i18n/en'
import type { Dict } from '@app/i18n/ja'

export type { Dict }

export function getDict(language: string): Dict {
  return language === 'en' ? en : ja
}
