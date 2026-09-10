import { motion } from 'framer-motion'

function MetricCard({ label, value, change, detail }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.2 }}
      className="glass-panel elevate-hover rounded-3xl p-5"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan">
          {change}
        </span>
      </div>
      <h3 className="mt-4 font-display text-3xl text-white">{value}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
    </motion.div>
  )
}

export default MetricCard
