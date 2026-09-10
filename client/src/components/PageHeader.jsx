import { motion } from 'framer-motion'

function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
    >
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan">{eyebrow}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-white md:text-5xl">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400 md:text-base">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </motion.div>
  )
}

export default PageHeader
