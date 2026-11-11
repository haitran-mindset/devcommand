import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './select'

type Option = string | { value: string; label: string; disabled?: boolean }
interface SelectFieldProps {
  label: string
  value: string
  options: readonly Option[]
  onValueChange: (value: string) => void
  id?: string
  disabled?: boolean
  required?: boolean
  size?: 'default' | 'sm'
  className?: string
}

/** Share the shadcn composition and preserve domain values, including the empty SSH identity. */
export function SelectField({ label, value, options, onValueChange, id, disabled, required, size = 'sm', className }: SelectFieldProps) {
  const items = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option)
  const selected = items.find((item) => item.value === value)
  // Radix reserves empty item values. Encode every option to avoid sentinel collisions with real values.
  return <Select value={selected ? `value:${selected.value}` : ''} onValueChange={(encoded) => {
    const item = items.find((item) => encoded === `value:${item.value}`)
    if (item) onValueChange(item.value)
  }} disabled={disabled} required={required}>
    <SelectTrigger id={id} aria-label={label} aria-required={required} size={size} className={className}><SelectValue placeholder="Select an option" /></SelectTrigger>
    <SelectContent position="popper"><SelectGroup>{items.map((item) => <SelectItem key={item.value} value={`value:${item.value}`} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>
}
