import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useAuth } from '../context/AuthContext'

const initialForm = {
  identifier: '',
  password: '',
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loginWithGoogle } = useAuth()
  const [formData, setFormData] = useState(initialForm)
  const [error, setError] = useState('')

  const redirectTo = location.state?.from
    ? `${location.state.from.pathname}${location.state.from.search ?? ''}`
    : '/home'

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    const result = await login(formData)

    if (!result.ok) {
      setError(result.message)
      return
    }

    navigate(redirectTo, { replace: true })
  }

  async function handleGoogleLogin() {
    setError('')
    const result = await loginWithGoogle()

    if (!result.ok) {
      setError(result.message)
    }
  }

  return (
    <AuthLayout
      eyebrow="Login"
      title="Welcome back to your investing workspace."
      description="Use your email or username to access your personal FinSense dashboard, profile, reports, and settings."
      footer={
        <p>
          New here?{' '}
          <Link to="/sign-in" className="font-medium text-cyan transition hover:text-aqua">
            Create an account
          </Link>
        </p>
      }
    >
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-cyan">Account access</p>
        <h2 className="mt-3 font-display text-3xl text-white">Login</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Demo account: <span className="text-slate-200">riya@finsense.ai</span> /{' '}
          <span className="text-slate-200">demo12345</span>
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Email address</span>
          <input
            className="input-shell w-full"
            type="email"
            placeholder="you@example.com"
            value={formData.identifier}
            onChange={(event) =>
              setFormData((current) => ({ ...current, identifier: event.target.value }))
            }
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Password</span>
          <input
            className="input-shell w-full"
            type="password"
            placeholder="Enter your password"
            value={formData.password}
            onChange={(event) =>
              setFormData((current) => ({ ...current, password: event.target.value }))
            }
            required
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary w-full">
          Login
        </button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs uppercase tracking-[0.24em] text-slate-500">or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <GoogleSignInButton onSuccess={handleGoogleLogin} onError={setError} text="signin_with" />
    </AuthLayout>
  )
}

export default LoginPage
