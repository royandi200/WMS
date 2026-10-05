import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

function compareValues(a, b) {
  const emptyA = a === null || a === undefined || a === ''
  const emptyB = b === null || b === undefined || b === ''
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const numA = Number(a)
  const numB = Number(b)
  if (a !== true && a !== false && Number.isFinite(numA) && Number.isFinite(numB)
    && String(a).trim() !== '' && String(b).trim() !== '') return numA - numB
  return collator.compare(String(a), String(b))
}

// Ordena en el cliente las filas ya cargadas. Tercer clic vuelve al orden
// original del servidor. accessors: { clave: fila => valor } para columnas
// calculadas; si no existe, se usa fila[clave].
export function useSortableRows(rows, accessors = {}) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const sorted = useMemo(() => {
    const list = Array.isArray(rows) ? rows : []
    if (!sort.key) return list
    const read = accessors[sort.key] || ((row) => row?.[sort.key])
    const factor = sort.dir === 'asc' ? 1 : -1
    return list
      .map((row, index) => ({ row, index }))
      .sort((x, y) => (compareValues(read(x.row), read(y.row)) * factor) || (x.index - y.index))
      .map(item => item.row)
  // accessors suele ser un objeto literal; las columnas no cambian entre renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const toggle = (key) => setSort(current => current.key !== key
    ? { key, dir: 'asc' }
    : current.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' })
  return { rows: sorted, sort, toggle }
}

// <th> clicable. Acepta className para conservar alineación y visibilidad.
export function SortableTh({ label, sortKey, sort, onSort, className = '', align = 'left' }) {
  const active = sort?.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-foreground' : ''}`}
        title="Ordenar"
      >
        <span>{label}</span>
        <Icon size={12} className={active ? 'text-primary' : 'opacity-40'} />
      </button>
    </th>
  )
}
