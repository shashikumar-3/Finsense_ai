
import { render, screen, waitFor } from '@testing-library/react'
import { useAuth, AuthProvider } from './AuthContext'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
  },
}))

function AuthProbe() {
  const { isAuthenticated, user, isAuthLoading } = useAuth()

  return (
    <div>
      <span data-testid="auth-state">{String(isAuthenticated)}</span>
      <span data-testid="auth-loading">{String(isAuthLoading)}</span>
      <span data-testid="current-user">
        {user ? user.email : 'none'}
      </span>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('starts logged out when there is no Supabase session', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('false')
      expect(screen.getByTestId('current-user')).toHaveTextContent('none')
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false')
    })
  })
})
