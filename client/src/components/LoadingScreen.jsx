export default function LoadingScreen({ message = 'Loading FinSense AI...' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07110d] px-4 text-white">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/10" />
          <div className="h-12 w-12 animate-spin rounded-full border-3 border-emerald-500/20 border-t-emerald-400" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
            {message}
          </p>
          <p className="text-xs text-slate-500">Preparing intelligent market insights</p>
        </div>
      </div>
    </div>
  )
}
