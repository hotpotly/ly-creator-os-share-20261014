import type { SelectHTMLAttributes } from 'react'
import { AppSelect } from './AppSelect'
import { ContentTypeLabel } from './ContentTypeLabel'
import { contentTypeAppearance } from '../../../shared/content-type-appearance'

/** Keeps the native select and change contract; only its visual label gains identity. */
export function ContentTypeSelect(props: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const id = String(props.value ?? props.defaultValue ?? '')
  return <span className="content-type-select" data-content-type={id} data-content-tone={contentTypeAppearance(id).tone}>
    <AppSelect {...props} renderOption={option => <ContentTypeLabel id={option.value} name={option.label} />} />
  </span>
}
