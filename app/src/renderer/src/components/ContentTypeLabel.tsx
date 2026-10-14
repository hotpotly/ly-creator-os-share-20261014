import { contentTypeAppearance } from '../../../shared/content-type-appearance'

export function ContentTypeLabel({ id, name }: { id: string; name: string }): React.JSX.Element {
  const { tone } = contentTypeAppearance(id)
  return <span className="content-type-label field-label" data-content-type={id} data-content-tone={tone}>
    <span className="content-type-name">{name}</span>
  </span>
}
