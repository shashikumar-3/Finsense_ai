import '@testing-library/jest-dom/vitest'

beforeEach(() => {
  window.localStorage.clear()
})

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
