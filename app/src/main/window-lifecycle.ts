let appQuitting = false

export function markAppQuitting(): void {
  appQuitting = true
}

export function isAppQuitting(): boolean {
  return appQuitting
}

export function shouldHideMainWindow(backgroundTest: boolean, quitting: boolean): boolean {
  return !backgroundTest && !quitting
}
