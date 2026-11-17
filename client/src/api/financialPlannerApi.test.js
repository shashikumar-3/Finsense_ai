import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }))
import { supabase } from '../lib/supabase'
import { deletePlanningRecord, simulateLifeEvent, updatePlanningRecord } from './financialPlannerApi'

describe('financial planner API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  })

  it('uses authenticated update and delete record routes', async () => {
    await updatePlanningRecord('goal', 'goal-id', { name: 'Updated' })
    await deletePlanningRecord('goal', 'goal-id')
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/financial-planner/records/goal/goal-id'), expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }))
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/financial-planner/records/goal/goal-id'), expect.objectContaining({ method: 'DELETE' }))
  })

  it('sends life-event assumptions without client-owned identity data', async () => {
    await simulateLifeEvent({ name: 'Leave', months: 2 })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/financial-planner/life-event'), expect.objectContaining({ body: JSON.stringify({ event: { name: 'Leave', months: 2 } }) }))
  })
})
