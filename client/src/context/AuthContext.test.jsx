import { render, screen } from '@testing-library/react'
import { useAuth, AuthProvider } from './AuthContext'

function AuthProbe() {
  const { isAuthenticated, users, user } = useAuth()

  return (
    <div>
      <span data-testid="auth-state">{String(isAuthenticated)}</span>
      <span data-testid="user-count">{String(users.length)}</span>
      <span data-testid="current-user">{user ? user.email : 'none'}</span>
    </div>
  )
}

describe('AuthProvider', () => {
  it('seeds the default demo user and starts logged out', () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('auth-state')).toHaveTextContent('false')
    expect(screen.getByTestId('user-count')).toHaveTextContent('1')
    expect(screen.getByTestId('current-user')).toHaveTextContent('none')
  })
})
