import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useAuth } from '../context/AuthContext'

const initialForm = {
  name: '',
  email: '',
  username: '',
  password: '',
}

function SignInPage() {
  const navigate = useNavigate()
  const { signUp, loginWithGoogle } = useAuth()
  const [formData, setFormData] = useState(initialForm)
  const [error, setError] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    const result = signUp(formData)

    if (!result.ok) {
      setError(result.message)
      return
    }

    navigate('/home', { replace: true })
  }

  async function handleGoogleSignIn(credential) {
    setError('')
    const result = await loginWithGoogle(credential)

    if (!result.ok) {
      setError(result.message)
      return
    }

    navigate('/home', { replace: true })
  }

  return (
    <AuthLayout
      eyebrow="Sign Up"
      title="Create your FinSense account and start with a protected home view."
      description="Sign up to unlock personal insights, profile details, reports, and settings nested directly inside your profile page."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-cyan transition hover:text-aqua">
            Login here
          </Link>
        </p>
      }
    >
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-cyan">New account</p>
        <h2 className="mt-3 font-display text-3xl text-white">Sign Up</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Create a local demo account. The app logs you in immediately after registration.
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Full name</span>
          <input
            className="input-shell w-full"
            placeholder="Aisha Mehta"
            value={formData.name}
            onChange={(event) =>
              setFormData((current) => ({ ...current, name: event.target.value }))
            }
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Email</span>
          <input
            className="input-shell w-full"
            type="email"
            placeholder="aisha@finsense.ai"
            value={formData.email}
            onChange={(event) =>
              setFormData((current) => ({ ...current, email: event.target.value }))
            }
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Username</span>
          <input
            className="input-shell w-full"
            placeholder="aishamehta"
            value={formData.username}
            onChange={(event) =>
              setFormData((current) => ({ ...current, username: event.target.value }))
            }
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Password</span>
          <input
            className="input-shell w-full"
            type="password"
            placeholder="Create a password"
            value={formData.password}
            onChange={(event) =>
              setFormData((current) => ({ ...current, password: event.target.value }))
            }
            minLength={8}
            required
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn-primary w-full">
          Create account
        </button>
      </form>

      <div className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs uppercase tracking-[0.24em] text-slate-500">or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <GoogleSignInButton onSuccess={handleGoogleSignIn} onError={setError} text="signup_with" />
    </AuthLayout>
  )
}

export default SignInPage
