import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import AppShell from './components/AppShell'
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards'
import AnalyticsPage from './pages/AnalyticsPage'
import DashboardPage from './pages/DashboardPage'
import InsightsPage from './pages/InsightsPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import ReportsPage from './pages/ReportsPage'
import SignInPage from './pages/SignInPage'
import StockDetailPage from './pages/StockDetailPage'
import StocksPage from './pages/StocksPage'
import { useAuth } from './context/AuthContext'

function ProtectedAppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function App() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={<Navigate to={isAuthenticated ? '/home' : '/login'} replace />}
        />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<ProtectedAppLayout />}>
            <Route path="/home" element={<DashboardPage />} />
            <Route path="/stocks" element={<StocksPage />} />
            <Route path="/stocks/:symbol" element={<StockDetailPage />} />
            <Route path="/dashboard" element={<Navigate to="/home" replace />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<Navigate to="/profile?tab=settings" replace />} />
          </Route>
        </Route>
      </Routes>
    </AnimatePresence>
  )
}

export default App
