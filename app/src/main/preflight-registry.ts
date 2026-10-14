export interface ExpiringPreflight {
  createdAt: number
}

export class PreflightRegistry<T extends ExpiringPreflight> {
  private readonly values = new Map<string, T>()

  set(id: string, value: T): void {
    this.values.set(id, value)
  }

  peek(id: string): T | null {
    return this.values.get(id) ?? null
  }

  consume(id: string): T | null {
    const value = this.values.get(id)
    if (!value) return null
    this.values.delete(id)
    return value
  }

  pruneOlderThan(cutoff: number): void {
    for (const [id, value] of this.values) if (value.createdAt < cutoff) this.values.delete(id)
  }
}
