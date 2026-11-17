function GoogleSignInButton({ onSuccess, onError, text = 'continue_with' }) {
  return (
    <button
      type="button"
      className="btn-secondary w-full"
      onClick={() => {
        console.info('[AUTH DEBUG] Google button clicked')
        onSuccess?.()
      }}
    >
      {text === 'signup_with' ? 'Sign up with Google' : 'Continue with Google'}
    </button>
  )
}

export default GoogleSignInButton
