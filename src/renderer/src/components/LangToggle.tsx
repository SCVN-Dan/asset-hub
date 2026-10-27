import { useTranslation } from 'react-i18next'
import { LANGUAGES, type Language } from '@shared/settings'

interface Props {
  value: Language
  onChange(language: Language): void
}

export function LangToggle({ value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div className="seg" role="group" aria-label={t('common.language')}>
      {LANGUAGES.map((lang) => (
        <button key={lang} type="button" aria-pressed={value === lang} onClick={() => onChange(lang)}>
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
