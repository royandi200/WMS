import { useEffect, useId, useRef, useState } from 'react'

// Reemplazo directo de <input>: mismo value/onChange(event) y demás props.
// Sugiere opciones mientras se escribe, pero nunca bloquea el texto libre;
// la validación final sigue en el servidor.
// fetchOptions(texto) => Promise<[{ value, label?, hint? }]>
export default function AutocompleteInput({
  value, onChange, fetchOptions, minChars = 1, className = 'input-field', onSelect, ...inputProps
}) {
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [focusTick, setFocusTick] = useState(0)
  const request = useRef(0)
  const focused = useRef(false)
  const listId = useId()
  const text = String(value ?? '')

  useEffect(() => {
    if (!focused.current) return undefined
    if (text.trim().length < minChars) { setOptions([]); return undefined }
    const version = ++request.current
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const found = await fetchOptions(text.trim())
        if (version !== request.current) return
        setOptions(Array.isArray(found) ? found.slice(0, 12) : [])
        setActive(-1)
        setOpen(true)
      } catch {
        if (version === request.current) setOptions([])
      } finally {
        if (version === request.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [text, minChars, fetchOptions, focusTick])

  const choose = (option) => {
    onChange?.({ target: { value: option.value, name: inputProps.name } })
    onSelect?.(option)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (event) => {
    if (open && options.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => (i + 1) % options.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => (i <= 0 ? options.length - 1 : i - 1)); return }
      if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(options[active]); return }
      if (event.key === 'Escape') { setOpen(false); return }
    }
    inputProps.onKeyDown?.(event)
  }

  const exactMatch = options.length === 1 && options[0].value.toLowerCase() === text.trim().toLowerCase()
  const showList = open && (options.length > 0 || loading) && !exactMatch

  return (
    <div className="relative">
      <input
        {...inputProps}
        value={value}
        onChange={(event) => { onChange?.(event); setOpen(true) }}
        onFocus={(event) => {
          focused.current = true
          if (options.length) setOpen(true)
          else if (minChars === 0) setFocusTick(tick => tick + 1)
          inputProps.onFocus?.(event)
        }}
        onBlur={(event) => { focused.current = false; setTimeout(() => setOpen(false), 150); inputProps.onBlur?.(event) }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        className={className}
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface shadow-lg text-sm">
          {loading && !options.length && <li className="px-3 py-2 text-muted">Buscando…</li>}
          {options.map((option, index) => (
            <li
              key={`${option.value}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => { event.preventDefault(); choose(option) }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-3 py-2 ${index === active ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-white/5'}`}
            >
              <span className="font-mono">{option.value}</span>
              {option.label && <span className="ml-2 text-muted">{option.label}</span>}
              {option.hint && <span className="block text-xs text-muted">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
