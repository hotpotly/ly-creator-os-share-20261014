import { platformToken } from '../../../shared/field-appearance'
import { FieldLabel } from './FieldLabel'
import { Check } from 'lucide-react'
import { PROJECT_PLATFORMS } from '../../../shared/domain'

function toggleProjectPlatform(platforms: string[], platform: string): string[] {
  return platforms.includes(platform)
    ? platforms.filter((item) => item !== platform)
    : [...platforms, platform]
}

function setPrimaryProjectPlatform(platforms: string[], platform: string): string[] {
  if (!platforms.includes(platform)) return platforms
  return [platform, ...platforms.filter((item) => item !== platform)]
}

export function ProjectPlatformSummary({ platforms, variant = 'text' }: { platforms: string[]; variant?: 'text' | 'chips' }): React.JSX.Element {
  if (!platforms.length) return <span className="project-platform-summary empty">未设置</span>
  return <span className={`project-platform-summary${variant === 'chips' ? ' chips' : ''}`}>{platforms.map((platform, index) => <FieldLabel key={platform} token={platformToken(platform)} className="platform-label">
    {index === 0 ? <i className="project-primary-platform-dot" aria-label="主平台" /> : null}
    {platform}
  </FieldLabel>)}</span>
}

export function ProjectPlatformControl({
  platforms,
  onChange,
  compact = false,
  disabled = false
}: {
  platforms: string[]
  onChange(platforms: string[]): void
  compact?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return <div className={`project-platform-control${compact ? ' compact' : ''}`} role="group" aria-label="发布平台">
    {PROJECT_PLATFORMS.map((platform) => {
      const selected = platforms.includes(platform)
      const primary = platforms[0] === platform
      return <div className={`project-platform-option${selected ? ' selected' : ''}${primary ? ' primary' : ''}`} key={platform}>
        <button
          type="button"
          className="project-platform-toggle"
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => onChange(toggleProjectPlatform(platforms, platform))}
        >
          <FieldLabel token={platformToken(platform)} className="platform-label">{platform}</FieldLabel>{selected ? <Check size={11} /> : null}
        </button>
        {selected ? <button
          type="button"
          className="project-platform-primary"
          aria-pressed={primary}
          aria-label={`${platform}${primary ? '当前为主平台' : '设为主平台'}`}
          title={primary ? '主平台' : '设为主平台'}
          disabled={disabled || primary}
          onClick={() => onChange(setPrimaryProjectPlatform(platforms, platform))}
        ><i /></button> : null}
      </div>
    })}
  </div>
}
