import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { navItems } from '../data/mockData'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../lib/preferences'

function Brand() {
  return (
    <NavLink to="/home" className="flex items-center gap-4">
      <div className="flex h-[74px] w-[118px] items-center justify-center rounded-[20px] bg-black shadow-[0_18px_40px_rgba(0,0,0,0.38)] ring-1 ring-white/5">
        <svg
          viewBox="0 0 120 92"
          className="h-[48px] w-[72px]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M10 66L32 46L48 50L67 22L84 8L101 16"
            stroke="#2CE57E"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11 20L31 32L45 28L63 49L82 63L100 76"
            stroke="#FF4A4A"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <p className="font-sans text-[28px] font-semibold tracking-[-0.04em] text-white md:text-[38px]">
          FinSense
        </p>
        <div className="-mt-2 flex items-center text-[22px] font-semibold tracking-[-0.04em] md:text-[30px]">
          <span className="text-aqua">A</span>
          <span className="text-[#ff4a4a]">I</span>
        </div>
      </div>
    </NavLink>
  )
}

function NavItems({ onClick }) {
  return (
    <>
      {navItems.map(({ label, path }) => (
        <NavLink
          key={path}
          to={path}
          onClick={onClick}
          className={({ isActive }) =>
            `rounded-full px-4 py-2 text-sm transition duration-300 ${
              isActive
                ? 'bg-white/10 text-white shadow-neon'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </>
  )
}

function UserSummary() {
  const { user } = useAuth()

  if (!user) {
    return null
  }

  return (
    <NavLink
      to="/profile"
      aria-label="Open profile"
      title="Open profile"
      className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan/20 bg-gradient-to-br from-cyan/30 to-aqua/20 font-semibold text-white shadow-neon transition hover:scale-105 hover:border-cyan/50 hover:bg-cyan/20 focus:outline-none focus:ring-2 focus:ring-cyan/60"
    >
      {user.avatar}
    </NavLink>
  )
}

function Header({ mobileOpen, setMobileOpen }) {
  return (
    <header className="glass-panel !overflow-visible sticky top-4 z-30 mx-auto mb-8 mt-4 flex w-full max-w-[1440px] items-center justify-between rounded-[26px] px-4 py-4 md:px-6">
      <Brand />

      <nav className="hidden items-center gap-2 xl:flex">
        <NavItems />
      </nav>

      <div className="flex items-center gap-3">
        <UserSummary />
        <button className="icon-button xl:hidden" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMobileOpen((value) => !value)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div
        className={`absolute left-0 right-0 top-[calc(100%+12px)] rounded-[24px] border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur-2xl transition xl:hidden ${
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex flex-col gap-2">
          <NavItems onClick={() => setMobileOpen(false)} />
        </div>
      </div>
    </header>
  )
}

function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useAuth()
  const preferences = usePreferences(user)

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.adaptiveDarkMode ? 'dark' : 'light'
    document.documentElement.dataset.density = preferences.compactDashboardDensity ? 'compact' : 'comfortable'
    document.documentElement.dataset.motion = preferences.motionEnhancedTransitions ? 'enhanced' : 'reduced'
  }, [preferences])

  return (
    <div className="min-h-screen bg-aurora text-slate-200">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="tech-line left-[-4%] top-[7rem] h-[18rem] w-[18rem]" />
        <div className="tech-line right-[6%] top-[9rem] h-[22rem] w-[22rem]" />
        <div className="absolute left-[12%] top-20 h-60 w-60 rounded-full bg-aqua/10 blur-3xl" />
        <div className="absolute right-[10%] top-24 h-72 w-72 rounded-full bg-cyan/10 blur-3xl" />
        <div className="absolute bottom-[18%] left-[38%] h-64 w-64 rounded-full bg-sky/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-[1520px] px-4 pb-10 md:px-6 lg:px-8">
        <Header mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

        <motion.main
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {children}
        </motion.main>
      </div>
    </div>
  )
}

export default AppShell
