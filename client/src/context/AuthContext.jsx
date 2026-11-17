import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const authDebug = (...args) => {
  if (import.meta.env.DEV) console.info(...args)
}

const authDebugError = (...args) => {
  if (import.meta.env.DEV) console.error(...args)
}

const PROFILE_REQUEST_TIMEOUT_MS = 8000

async function withProfileTimeout(request, message) {
  let timeoutId
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), PROFILE_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
  }
}

function buildAvatar(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
}

function buildBaseAccountInfo(overrides = {}) {
  return {
    membership: 'Starter account',
    planStatus: 'Active',
    joinedOn: new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    ...overrides,
  }
}

function mapProfileToUser(authUser, profile) {
  const metadata = authUser.user_metadata ?? {}
  const joinedOn = profile?.joined_on || profile?.created_at

  const displayName =
    profile?.display_name ||
    metadata.full_name ||
    metadata.name ||
    authUser.email ||
    'FinSense user'

  return {
    id: authUser.id,
    name: displayName,
    email: authUser.email?.toLowerCase() ?? '',
    username: profile?.username || metadata.username || '',
    avatar: profile?.avatar || metadata.avatar || buildAvatar(displayName),
    avatar_url:
      profile?.avatar_url ||
      metadata.avatar_url ||
      metadata.picture ||
      null,
    preferences: metadata.finsense_preferences || {},
    authProvider:
      profile?.auth_provider ||
      metadata.auth_provider ||
      authUser.app_metadata?.provider ||
      'local',
    accountInfo: buildBaseAccountInfo({
      membership:
        profile?.membership ||
        metadata.membership ||
        'Starter account',
      planStatus:
        profile?.plan_status ||
        metadata.plan_status ||
        'Active',
      ...(joinedOn ? { joinedOn } : {}),
    }),
  }
}

async function fetchProfile(userId) {
  return withProfileTimeout(
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle(),
    'Profile service timed out.',
  )
}

async function ensureProfileRow(authUser) {
  const metadata = authUser.user_metadata ?? {}

  const displayName =
    metadata.full_name ||
    metadata.name ||
    authUser.email ||
    'FinSense user'

  const username =
    metadata.username ||
    authUser.email?.split('@')[0] ||
    `user-${authUser.id.replace(/-/g, '').slice(0, 12)}`

  const { data: profile, error } = await withProfileTimeout(
    supabase
      .from('profiles')
      .upsert(
        {
          id: authUser.id,
          display_name: displayName,
          username,
          avatar: metadata.avatar || buildAvatar(displayName),
          avatar_url:
            metadata.avatar_url ||
            metadata.picture ||
            null,
          auth_provider:
            authUser.app_metadata?.provider ||
            'google',
          membership:
            metadata.membership ||
            'Starter account',
          plan_status:
            metadata.plan_status ||
            'Active',
        },
        {
          onConflict: 'id',
        },
      )
      .select('*')
      .maybeSingle(),
    'Profile service timed out.',
  )

  return { profile, error }
}

async function loadAuthenticatedUser(authUser) {
  authDebug('[AUTH DEBUG] Supabase user:', {
    id: authUser?.id,
    email: authUser?.email,
    provider: authUser?.app_metadata?.provider,
  })

  let profile = null
  let error = null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let result
    try {
      result = await fetchProfile(authUser.id)
    } catch (requestError) {
      error = requestError
      break
    }

    profile = result.data
    error = result.error

    if (error) {
      break
    }

    if (profile) {
      break
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 250 * (attempt + 1))
    })
  }

  if (!profile && !error) {
    try {
      const ensured = await ensureProfileRow(authUser)
      profile = ensured.profile
      error = ensured.error
    } catch (requestError) {
      error = requestError
    }
  }

  if (error) {
    authDebugError('[AUTH DEBUG] Profile query error:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      userId: authUser?.id,
    })

    authDebug('[GOOGLE DEBUG] profile result:', {
      found: false,
      error: error.message,
    })

    // A verified Supabase session is sufficient to render the protected shell.
    // Profile editing can retry later; it must not leave the entire application
    // on a blank auth-loading screen when the profile table is temporarily down.
    return { user: mapProfileToUser(authUser, null), error: null, profileError: error }
  }

  authDebug('[AUTH DEBUG] Profile query result:', {
    found: Boolean(profile),
    userId: authUser?.id,
  })

  authDebug('[GOOGLE DEBUG] profile result:', {
    found: Boolean(profile),
    userId: authUser?.id,
  })

  if (!profile) {
    return {
      user: null,
      error: new Error(
        'Authenticated user profile is missing.',
      ),
    }
  }

  return {
    user: mapProfileToUser(authUser, profile),
    error: null,
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  const loadedSessionUserId = useRef(null)
  const pendingSessionUserId = useRef(null)

  useEffect(() => {
    let active = true

    async function applySession(session) {
      if (!active) {
        return
      }

      if (!session?.user) {
        authDebug('[AUTH DEBUG] No Supabase session')

        loadedSessionUserId.current = null
        setUser(null)
        setIsAuthLoading(false)

        return
      }

      if (
        loadedSessionUserId.current ===
        session.user.id
      ) {
        setIsAuthLoading(false)
        return
      }

      if (
        pendingSessionUserId.current ===
        session.user.id
      ) {
        return
      }

      pendingSessionUserId.current =
        session.user.id

      const result =
        await loadAuthenticatedUser(session.user)

      pendingSessionUserId.current = null

      if (!active) {
        return
      }

      if (result.error) {
        authDebugError(
          'Unable to restore Supabase session profile.',
          result.error,
        )

        loadedSessionUserId.current = null
        setUser(null)
        setIsAuthLoading(false)

        return
      }

      loadedSessionUserId.current =
        session.user.id

      authDebug(
        '[AUTH DEBUG] Setting authenticated user:',
        {
          id: result.user?.id,
          email: result.user?.email,
        },
      )

      setUser(result.user)
      setIsAuthLoading(false)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        authDebug(
          '[AUTH DEBUG] onAuthStateChange event:',
          {
            event,
            hasSession: Boolean(session),
            userId: session?.user?.id,
          },
        )

        if (
          [
            'INITIAL_SESSION',
            'SIGNED_IN',
            'SIGNED_OUT',
            'TOKEN_REFRESHED',
          ].includes(event)
        ) {
          setTimeout(() => {
            void applySession(session)
          }, 0)
        }
      },
    )

    authDebug(
      '[AUTH DEBUG] Current URL after OAuth callback:',
      {
        pathname: window.location.pathname,
        searchKeys: [
          ...new URLSearchParams(
            window.location.search,
          ).keys(),
        ],
        hasHash: Boolean(window.location.hash),
        hashKeys: [
          ...new URLSearchParams(
            window.location.hash.replace(/^#/, ''),
          ).keys(),
        ],
      },
    )

    authDebug('[AUTH DEBUG] getSession started')

    withProfileTimeout(
      supabase.auth.getSession(),
      'Authentication service timed out.',
    )
      .then(({ data, error }) => {
        authDebug(
          '[AUTH DEBUG] getSession result:',
          {
            hasSession: Boolean(data.session),
            userId: data.session?.user?.id,
            error: error
              ? {
                  code: error.code,
                  message: error.message,
                  name: error.name,
                }
              : null,
          },
        )

        if (error) {
          throw error
        }

        return applySession(data.session)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        authDebugError(
          'Unable to restore Supabase session.',
          error,
        )

        setUser(null)
        setIsAuthLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      isAuthLoading,
      user,

      async signUp(formData) {
        const normalizedEmail =
          formData.email.trim().toLowerCase()

        const normalizedUsername =
          formData.username.trim().toLowerCase()

        const name = formData.name.trim()
        const avatar = buildAvatar(name)

        let data
        let error

        try {
          const result =
            await supabase.auth.signUp({
              email: normalizedEmail,
              password: formData.password,
              options: {
                data: {
                  full_name: name,
                  username: normalizedUsername,
                  avatar,
                  auth_provider: 'local',
                  membership: 'Starter account',
                  plan_status: 'Active',
                },
              },
            })

          data = result.data
          error = result.error
        } catch {
          return {
            ok: false,
            message:
              'Unable to reach the authentication service.',
          }
        }

        if (error) {
          return {
            ok: false,
            message:
              error.message ||
              'Unable to create your account.',
          }
        }

        if (!data.user) {
          return {
            ok: false,
            message:
              'Supabase did not return a user for this signup.',
          }
        }

        const metadata =
          data.user.user_metadata ?? {}

        const newUser = {
          id: data.user.id,
          name:
            metadata.full_name || name,
          email:
            data.user.email?.toLowerCase() ??
            normalizedEmail,
          username:
            metadata.username ||
            normalizedUsername,
          avatar:
            metadata.avatar || avatar,
          authProvider:
            metadata.auth_provider ||
            'email',
          accountInfo:
            buildBaseAccountInfo({
              membership:
                metadata.membership ||
                'Starter account',
              planStatus:
                metadata.plan_status ||
                'Active',
            }),
        }

        if (data.session) {
          loadedSessionUserId.current =
            data.user.id

          setUser(newUser)
        }

        return {
          ok: true,
          user: data.session
            ? newUser
            : null,
          requiresEmailConfirmation:
            !data.session,
        }
      },

      async login(formData) {
        const credential =
          formData.identifier
            .trim()
            .toLowerCase()

        if (!credential.includes('@')) {
          return {
            ok: false,
            message:
              'Please enter the email address used for your FinSense account.',
          }
        }

        let data
        let error

        try {
          const result =
            await supabase.auth.signInWithPassword(
              {
                email: credential,
                password: formData.password,
              },
            )

          data = result.data
          error = result.error
        } catch {
          return {
            ok: false,
            message:
              'Unable to reach the authentication service.',
          }
        }

        if (error) {
          return {
            ok: false,
            message:
              error.message ||
              'Invalid email or password.',
          }
        }

        if (!data?.user) {
          return {
            ok: false,
            message:
              'Authentication succeeded without returning a user.',
          }
        }

        const {
          user: authenticatedUser,
          error: profileError,
        } = await loadAuthenticatedUser(
          data.user,
        )

        if (profileError) {
          return {
            ok: false,
            message:
              'Unable to load your account profile. Please try again.',
          }
        }

        if (!authenticatedUser) {
          return {
            ok: false,
            message:
              'Your account profile is missing. Please contact support.',
          }
        }

        loadedSessionUserId.current =
          data.user.id

        setUser(authenticatedUser)

        return {
          ok: true,
          user: authenticatedUser,
        }
      },

      async loginWithGoogle() {
        try {
          authDebug(
            '[AUTH DEBUG] Google OAuth started',
          )

          const { error } =
            await supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo:
                  window.location.origin,
              },
            })

          if (error) {
            return {
              ok: false,
              message:
                error.message ||
                'Google sign-in failed.',
            }
          }

          return { ok: true }
        } catch (error) {
          if (error instanceof TypeError) {
            return {
              ok: false,
              message:
                'Authentication service is not running on http://localhost:5000.',
            }
          }

          return {
            ok: false,
            message:
              'Unable to reach the authentication service.',
          }
        }
      },

      async logout() {
        const { error } =
          await supabase.auth.signOut()

        if (error) {
          return {
            ok: false,
            message:
              error.message ||
              'Unable to sign out. Please try again.',
          }
        }

        loadedSessionUserId.current = null
        setUser(null)

        return { ok: true }
      },
    }),
    [isAuthLoading, user],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error(
      'useAuth must be used within an AuthProvider',
    )
  }

  return context
}
