import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

function AuthLayout({ eyebrow, title, description, footer, children }) {
  return (
    <div className="min-h-screen bg-aurora px-4 py-6 text-slate-200 md:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="tech-line left-[6%] top-24 h-40 w-40" />
        <div className="tech-line right-[9%] top-32 h-52 w-52" />
        <div className="absolute left-[10%] top-20 h-64 w-64 rounded-full bg-aqua/10 blur-3xl" />
        <div className="absolute bottom-[16%] right-[12%] h-72 w-72 rounded-full bg-cyan/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1240px] items-center">
        <div className="grid w-full gap-6 xl:grid-cols-[1fr_0.9fr]">
          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="hero-shell flex min-h-[520px] flex-col justify-between px-6 py-8 md:px-8 md:py-10"
          >
            <div>
              <Link to="/" className="inline-flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-black shadow-[0_18px_40px_rgba(0,0,0,0.38)] ring-1 ring-white/5">
                  <span className="font-display text-xl text-aqua">F</span>
                </div>
                <div>
                  <p className="font-sans text-2xl font-semibold tracking-[-0.04em] text-white">
                    FinSense
                  </p>
                  <div className="-mt-1 flex items-center text-xl font-semibold tracking-[-0.04em]">
                    <span className="text-aqua">A</span>
                    <span className="text-[#ff4a4a]">I</span>
                  </div>
                </div>
              </Link>
            </div>

            <div className="max-w-xl">
              <p className="hero-badge inline-flex rounded-full px-4 py-2 text-xs uppercase tracking-[0.28em] text-cyan">
                {eyebrow}
              </p>
              <h1 className="mt-8 font-display text-4xl font-semibold leading-tight text-white md:text-6xl">
                {title}
              </h1>
              <p className="mt-6 max-w-lg text-base leading-8 text-slate-300">{description}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['Portfolio clarity', 'Single place for account, planning, and intelligence.'],
                ['Fast access', 'Protected routes keep personal workflows behind login.'],
                ['User profile', 'Profile now reflects live account details after auth.'],
              ].map(([heading, copy]) => (
                <div key={heading} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="font-medium text-white">{heading}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.05 }}
            className="glass-panel flex items-center rounded-[32px] px-5 py-6 md:px-8 md:py-8"
          >
            <div className="w-full">
              {children}
              {footer ? <div className="mt-6 text-sm text-slate-400">{footer}</div> : null}
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
