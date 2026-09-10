import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const USERS_STORAGE_KEY = 'finsense.auth.users'
const SESSION_STORAGE_KEY = 'finsense.auth.session'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000'

const defaultSeedUser = {
  id: 'seed-user',
  name: 'Riya Shah',
  email: 'riya@finsense.ai',
  username: 'riyashah',
  password: 'demo12345',
  avatar: 'RS',
  accountInfo: {
    membership: 'Founding member',
    planStatus: 'Active',
    joinedOn: '12 Apr 2026',
  },
}

const AuthContext = createContext(null)

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

function mergeUser(users, nextUser) {
  const existingIndex = users.findIndex(
    (entry) =>
      (nextUser.googleSub && entry.googleSub === nextUser.googleSub) ||
      entry.email.toLowerCase() === nextUser.email.toLowerCase(),
  )

  if (existingIndex === -1) {
    return [...users, nextUser]
  }

  const currentUser = users[existingIndex]
  const mergedUser = {
    ...currentUser,
    ...nextUser,
    accountInfo: {
      ...currentUser.accountInfo,
      ...nextUser.accountInfo,
    },
  }

  return users.map((entry, index) => (index === existingIndex ? mergedUser : entry))
}

function readStoredUsers() {
  if (typeof window === 'undefined') {
    return [defaultSeedUser]
  }

  const storedUsers = window.localStorage.getItem(USERS_STORAGE_KEY)

  if (!storedUsers) {
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify([defaultSeedUser]))
    return [defaultSeedUser]
  }

  try {
    const parsedUsers = JSON.parse(storedUsers)

    return parsedUsers.length ? parsedUsers : [defaultSeedUser]
  } catch {
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify([defaultSeedUser]))
    return [defaultSeedUser]
  }
}

function readStoredSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const storedSession = window.localStorage.getItem(SESSION_STORAGE_KEY)

  if (!storedSession) {
    return null
  }

  try {
    return JSON.parse(storedSession)
  } catch {
    return null
  }
}

function persistUsers(users) {
  window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
}

function persistSession(user) {
  if (!user) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
}

async function readJsonResponse(response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    return null
  }

  return response.json()
}

export function AuthProvider({ children }) {
  const [users, setUsers] = useState(() => readStoredUsers())
  const [user, setUser] = useState(() => readStoredSession())

  useEffect(() => {
    persistUsers(users)
  }, [users])

  useEffect(() => {
    persistSession(user)
  }, [user])

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      user,
      users,
      signUp(formData) {
        const normalizedEmail = formData.email.trim().toLowerCase()
        const normalizedUsername = formData.username.trim().toLowerCase()

        const existingUser = users.find(
          (entry) =>
            entry.email.toLowerCase() === normalizedEmail ||
            entry.username.toLowerCase() === normalizedUsername,
        )

        if (existingUser) {
          return {
            ok: false,
            message: 'An account with that email or username already exists.',
          }
        }

        const newUser = {
          id: `user-${Date.now()}`,
          name: formData.name.trim(),
          email: normalizedEmail,
          username: normalizedUsername,
          password: formData.password,
          avatar: buildAvatar(formData.name),
          authProvider: 'local',
          accountInfo: buildBaseAccountInfo(),
        }

        const nextUsers = [...users, newUser]
        setUsers(nextUsers)
        setUser(newUser)

        return { ok: true, user: newUser }
      },
      login(formData) {
        const credential = formData.identifier.trim().toLowerCase()
        const matchedUser = users.find(
          (entry) =>
            entry.email.toLowerCase() === credential ||
            entry.username.toLowerCase() === credential,
        )

        if (!matchedUser || matchedUser.password !== formData.password) {
          return {
            ok: false,
            message: 'Invalid email/username or password.',
          }
        }

        setUser(matchedUser)

        return { ok: true, user: matchedUser }
      },
      async loginWithGoogle(credential) {
        try {
          const response = await fetch(`${API_BASE_URL}/auth/google`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ credential }),
          })

          const payload = await readJsonResponse(response)

          if (!response.ok) {
            return {
              ok: false,
              message: payload?.message ?? 'Google sign-in failed.',
            }
          }

          if (!payload?.user) {
            return {
              ok: false,
              message: 'Authentication service returned an invalid response.',
            }
          }

          const googleUser = {
            id: `google-${payload.user.sub}`,
            googleSub: payload.user.sub,
            name: payload.user.name,
            email: payload.user.email.toLowerCase(),
            username:
              payload.user.email.split('@')[0].toLowerCase() ||
              `googleuser${payload.user.sub.slice(-6)}`,
            avatar: buildAvatar(payload.user.name),
            picture: payload.user.picture,
            password: null,
            authProvider: 'google',
            accountInfo: buildBaseAccountInfo({
              membership: 'Google account',
            }),
          }

          const nextUsers = mergeUser(users, googleUser)
          const sessionUser =
            nextUsers.find((entry) => entry.googleSub === googleUser.googleSub) ?? googleUser

          setUsers(nextUsers)
          setUser(sessionUser)

          return { ok: true, user: sessionUser }
        } catch (error) {
          if (error instanceof TypeError) {
            return {
              ok: false,
              message: 'Authentication service is not running on http://localhost:5000.',
            }
          }

          return {
            ok: false,
            message: 'Unable to reach the authentication service.',
          }
        }
      },
      logout() {
        setUser(null)
      },
    }),
    [user, users],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
