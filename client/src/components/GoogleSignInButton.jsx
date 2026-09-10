import { useEffect, useRef, useState } from 'react'

function GoogleSignInButton({ onSuccess, onError, text = 'continue_with' }) {
  const buttonRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  useEffect(() => {
    if (!clientId) {
      setStatus('missing_client_id')
      return undefined
    }

    let cancelled = false

    function renderButton() {
      if (cancelled || !window.google?.accounts?.id || !buttonRef.current) {
        return
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          if (!credential) {
            onError?.('Google did not return a credential.')
            return
          }

          onSuccess(credential)
        },
        ux_mode: 'popup',
        use_fedcm_for_prompt: true,
      })

      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        text,
        shape: 'pill',
        width: 360,
      })
      setStatus('ready')
    }

    if (window.google?.accounts?.id) {
      renderButton()
      return () => {
        cancelled = true
      }
    }

    const existingScript = document.querySelector('script[data-google-identity="true"]')

    const handleLoad = () => renderButton()
    const handleError = () => {
      if (!cancelled) {
        setStatus('error')
      }
    }

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad)
      existingScript.addEventListener('error', handleError)
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.googleIdentity = 'true'
      script.addEventListener('load', handleLoad)
      script.addEventListener('error', handleError)
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      const script = document.querySelector('script[data-google-identity="true"]')

      if (script) {
        script.removeEventListener('load', handleLoad)
        script.removeEventListener('error', handleError)
      }
    }
  }, [clientId, onError, onSuccess, text])

  if (status === 'missing_client_id') {
    return (
      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Set <code>VITE_GOOGLE_CLIENT_ID</code> to enable Google sign-in.
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        Google Identity Services failed to load.
      </div>
    )
  }

  return (
    <div>
      <div ref={buttonRef} className="google-button-shell flex min-h-11 items-center justify-center" />
      {status === 'loading' ? <p className="mt-2 text-xs text-slate-500">Loading Google sign-in…</p> : null}
    </div>
  )
}

export default GoogleSignInButton
