function SectionCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`glass-panel elevate-hover rounded-[30px] p-5 md:p-6 ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl font-semibold text-white">{title}</h3>
          {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default SectionCard
