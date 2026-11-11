import { describe, expect, it } from 'vitest'
import * as application from './application/index'
import * as domain from './domain/index'
import * as root from './index'
import * as dom from './infrastructure/dom/index'
import * as ssr from './infrastructure/ssr/index'

const surfaces = {
    root,
    application,
    domain,
    dom,
    ssr,
} as const

describe('public surface', () => {
    it('[API #2] 公共面不得出現 Sync 或 Async 後綴', () => {
        const offenders: string[] = []
        for (const [surface, exports] of Object.entries(surfaces)) {
            for (const name of Object.keys(exports)) {
                if (/(Sync|Async)$/.test(name)) {
                    offenders.push(`${surface}.${name}`)
                }
            }
        }
        expect(offenders).toEqual([])
    })
})
