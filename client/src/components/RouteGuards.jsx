import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingScreen from './LoadingScreen'

export function ProtectedRoute() {
  const { isAuthenticated, isAuthLoading } = useAuth()
  const location = useLocation()

  if (isAuthLoading) {
    if (import.meta.env.DEV) {
      console.info('[AUTH DEBUG] Route guard decision:', {
        route: 'protected',
        decision: 'wait-auth-loading',
      })
    }
    return <LoadingScreen message="Checking authorization..." />
  }

  if (!isAuthenticated) {
    if (import.meta.env.DEV) {
      console.info('[AUTH DEBUG] Route guard decision:', {
        route: 'protected',
        decision: 'redirect-login',
      })
    }
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (import.meta.env.DEV) {
    console.info('[AUTH DEBUG] Route guard decision:', {
      route: 'protected',
      decision: 'allow',
    })
  }

  return <Outlet />
}

export function PublicOnlyRoute() {
  const { isAuthenticated, isAuthLoading } = useAuth()

  if (isAuthLoading) {
    if (import.meta.env.DEV) {
      console.info('[AUTH DEBUG] Route guard decision:', {
        route: 'public-only',
        decision: 'wait-auth-loading',
      })
    }
    return <LoadingScreen message="Checking session..." />
  }

  if (isAuthenticated) {
    if (import.meta.env.DEV) {
      console.info('[AUTH DEBUG] Route guard decision:', {
        route: 'public-only',
        decision: 'redirect-home',
      })
    }
    return <Navigate to="/home" replace />
  }

  if (import.meta.env.DEV) {
    console.info('[AUTH DEBUG] Route guard decision:', {
      route: 'public-only',
      decision: 'allow',
    })
  }

  return <Outlet />
}
