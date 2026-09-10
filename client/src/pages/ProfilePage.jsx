import { Check, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import {
  profileAccountItems,
  profileHighlights,
  settingsGroups,
} from '../data/mockData'
import { useAuth } from '../context/AuthContext'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
]

function Toggle({ enabled }) {
  return (
    <div
      className={`flex h-8 w-14 items-center rounded-full border p-1 transition ${
        enabled ? 'border-cyan/20 bg-neon shadow-neon' : 'border-white/10 bg-white/10'
      }`}
    >
      <div
        className={`h-6 w-6 rounded-full bg-white transition ${
          enabled ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </div>
  )
}

function ProfilePage() {
  const { user, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = tabs.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'overview'

  const profileSummary = {
    name: user.name,
    role: 'FinSense account owner',
    location: user.email,
    riskBand: 'Balanced',
    goal: 'Build higher-confidence financial decisions',
  }

  return (
    <div>
      <PageHeader
        eyebrow="Profile"
        title="Account profile, identity, and settings"
        description="Profile now reflects the authenticated user and keeps account settings directly inside the same protected page."
        actions={tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSearchParams(tab.id === 'overview' ? {} : { tab: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Account card">
          <div className="rounded-[30px] border border-white/10 bg-gradient-to-br from-sky/20 via-white/5 to-cyan/20 p-6 shadow-neon">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-gold via-rose to-sky font-display text-3xl text-white">
                {user.avatar}
              </div>
              <div>
                <h3 className="font-display text-3xl text-white">{profileSummary.name}</h3>
                <p className="mt-2 text-slate-300">{profileSummary.role}</p>
                <p className="text-sm text-slate-400">{profileSummary.location}</p>
                <p className="mt-1 text-sm text-cyan">@{user.username}</p>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                <p className="text-sm text-slate-400">Risk band</p>
                <p className="mt-2 font-semibold text-white">{profileSummary.riskBand}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                <p className="text-sm text-slate-400">Primary goal</p>
                <p className="mt-2 font-semibold text-white">{profileSummary.goal}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        {activeTab === 'overview' ? (
          <SectionCard title="Logged-in details" subtitle="Live account data from the authenticated session.">
            <div className="grid gap-4 md:grid-cols-3">
              {profileAccountItems.map(({ label, key, icon: Icon }) => (
                <div
                  key={label}
                  className="elevate-hover rounded-[26px] border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan/20 bg-white/10 text-cyan">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-sm text-slate-400">{label}</p>
                  <h3 className="mt-2 font-display text-2xl text-white">
                    {user.accountInfo[key]}
                  </h3>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {[
                ['Name', user.name],
                ['Email', user.email],
                ['Username', user.username],
                ['Avatar', user.avatar],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="mt-2 text-base font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {profileHighlights.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="elevate-hover rounded-[26px] border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan/20 bg-white/10 text-cyan">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-sm text-slate-400">{label}</p>
                  <h3 className="mt-2 font-display text-2xl text-white">{value}</h3>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Settings" subtitle="Settings are now nested directly under Profile.">
            <div className="space-y-6">
              {settingsGroups.map((group) => (
                <div key={group.title} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-display text-xl text-white">{group.title}</h3>
                  <div className="mt-4 space-y-4">
                    {group.items.map((item) => (
                      <div
                        key={item.name}
                        className="elevate-hover flex items-center justify-between rounded-[24px] border border-white/10 bg-slate-950/30 px-4 py-4"
                      >
                        <div>
                          <p className="font-medium text-white">{item.name}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            Personal preference stored for this profile experience.
                          </p>
                        </div>
                        <Toggle enabled={item.enabled} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                <h3 className="font-display text-xl text-white">Security & access</h3>
                <div className="mt-4 space-y-4">
                  {['Two-factor authentication', 'Session management', 'Device trust list'].map((item) => (
                    <div
                      key={item}
                      className="elevate-hover flex items-center justify-between rounded-[24px] border border-white/10 bg-slate-950/30 px-4 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan/20 bg-cyan/10 text-cyan">
                          <Check className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium text-white">{item}</p>
                          <p className="text-sm text-slate-500">Managed as part of your profile access area</p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      <SectionCard
        title="Account actions"
        subtitle="Manage your current session from your profile."
        className="mt-6"
      >
        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-base font-medium text-white">Sign out of FinSense</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              End this session on the current device and return to the login page.
            </p>
          </div>
          <button className="btn-secondary min-w-40" onClick={logout}>
            Logout
          </button>
        </div>
      </SectionCard>
    </div>
  )
}

export default ProfilePage
