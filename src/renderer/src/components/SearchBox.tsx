import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSearch } from '@core/index'
import { SearchIcon } from './Icons'

interface Props {
  value: string
  search: AssetSearch
  onChange(value: string): void
}

/** Search field with keyword suggestions (groups like "fish", and words used in file names). */
export function SearchBox({ value, search, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const suggestions = useMemo(() => (open ? search.suggest(value) : []), [open, search, value])
  const choose = (text: string) => {
    onChange(text)
    setOpen(false)
  }

  return (
    <div className="search search-box">
      <SearchIcon />
      <label htmlFor="q" className="sr-only">
        {t('browse.search')}
      </label>
      <input
        id="q"
        type="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls="q-suggestions"
        placeholder={t('browse.searchPlaceholder')}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!suggestions.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
          } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault()
            choose(suggestions[active]?.text ?? value)
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {suggestions.length > 0 && (
        <ul id="q-suggestions" className="search-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.text}
              role="option"
              aria-selected={i === active}
              className="picker-option"
              data-active={i === active}
              // mousedown: runs before the input loses focus and closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(s.text)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="picker-option-text">
                {s.text}
                {s.examples?.length ? <span className="muted"> · {t('search.includes', { names: s.examples.join(', ') })}</span> : null}
              </span>
              <span className="muted small">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
