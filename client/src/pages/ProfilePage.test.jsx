import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import { supabase } from '../lib/supabase'

const updateUser = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Test User', email: 'test@example.com', username: 'tester', avatar: 'TU', accountInfo: { membership: 'Starter', planStatus: 'Active', joinedOn: '17 Nov 2026' } }, logout: vi.fn() }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}))

describe('Profile settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateUser.mockResolvedValue({ data: { user: {} }, error: null })
    supabase.auth.updateUser.mockImplementation(updateUser)
    window.localStorage.clear()
  })

  it('persists each preference through authenticated Supabase metadata', async () => {
    render(<MemoryRouter initialEntries={['/profile?tab=settings']}><ProfilePage /></MemoryRouter>)
    for (const label of [
      'Toggle Adaptive dark mode',
      'Toggle Compact dashboard density',
      'Toggle Motion-enhanced transitions',
      'Toggle Behavioral alerts',
      'Toggle Macro ripple scenarios',
      'Toggle High-risk trading warnings',
    ]) fireEvent.click(screen.getByRole('switch', { name: label }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(6))
    expect(JSON.parse(window.localStorage.getItem('finsense.preferences.user-1'))).toMatchObject({
      adaptiveDarkMode: false,
      compactDashboardDensity: true,
      motionEnhancedTransitions: false,
      behavioralAlerts: false,
      macroRippleScenarios: false,
      highRiskTradingWarnings: true,
    })
  })
})
