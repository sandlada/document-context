import { describe, expect, it } from 'vitest'
import { lifecycleEventForStatus } from './lifecycle'

describe('lifecycle', () => {
    it('[RX #5] starting 沒有對應的生命週期事件', () => {
        expect(lifecycleEventForStatus('starting')).toBeNull()
    })

    it('[RX #5] 其餘狀態各自對應一筆事件', () => {
        expect(lifecycleEventForStatus('active')).toEqual({ type: 'active' })
        expect(lifecycleEventForStatus('suspended')).toEqual({ type: 'suspended' })
        expect(lifecycleEventForStatus('disposed')).toEqual({ type: 'disposed', reason: 'explicit' })
    })
})
