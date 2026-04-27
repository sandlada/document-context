import type { IContextData } from "./context-data";
import type { IThemeConfig } from "./theme-config";

export const ContextSymbol = Symbol('DocumentContext');

const DefaultLocalStorageKey = 'theme-config'

const isThemeConfig = (obj: any): obj is IThemeConfig => {
    return (
        typeof obj === 'object' &&
        typeof obj?.isDark === 'boolean' &&
        typeof obj?.sourceColorArgb === 'number' &&
        typeof obj?.contrastLevel === 'number' &&
        typeof obj?.variant === 'number' &&
        typeof obj?.primaryPaletteArgb === 'number' &&
        typeof obj?.secondaryPaletteArgb === 'number' &&
        typeof obj?.tertiaryPaletteArgb === 'number' &&
        typeof obj?.errorPaletteArgb === 'number' &&
        typeof obj?.neutralPaletteArgb === 'number' &&
        typeof obj?.neutralVariantPaletteArgb === 'number' &&
        typeof obj?.specVersion === 'string'
    )
}
const getIsDark = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isDark === 'undefined') throw new Error('isDark is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isDark
}
const getSourceColorArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.sourceColorArgb === 'undefined') throw new Error('sourceColorArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.sourceColorArgb
}
const getContrastLevel = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.contrastLevel === 'undefined') throw new Error('contrastLevel is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.contrastLevel
}
const getVariant = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.variant === 'undefined') throw new Error('variant is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.variant
}
const getPrimaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.primaryPaletteArgb === 'undefined') throw new Error('primaryPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.primaryPaletteArgb
}
const getSecondaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.secondaryPaletteArgb === 'undefined') throw new Error('secondaryPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.secondaryPaletteArgb
}
const getTertiaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.tertiaryPaletteArgb === 'undefined') throw new Error('tertiaryPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.tertiaryPaletteArgb
}
const getErrorPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.errorPaletteArgb === 'undefined') throw new Error('errorPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.errorPaletteArgb
}
const getNeutralPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.neutralPaletteArgb === 'undefined') throw new Error('neutralPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.neutralPaletteArgb
}
const getNeutralVariantPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }): number => {
    if (typeof d[ContextSymbol]?.themeConfig.neutralVariantPaletteArgb === 'undefined') throw new Error('neutralVariantPaletteArgb is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.neutralVariantPaletteArgb
}
const getSpecVersion = (d: Document & { [ContextSymbol]?: IContextData }): string => {
    if (typeof d[ContextSymbol]?.themeConfig.specVersion === 'undefined') throw new Error('specVersion is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.specVersion
}

const themeSetIsDark = (d: Document & { [ContextSymbol]?: IContextData }, isDark: boolean) => {
    d[ContextSymbol].themeConfig.isDark = isDark
}
const themeSetSourceColorArgb = (d: Document & { [ContextSymbol]?: IContextData }, sourceColorArgb: number) => {
    d[ContextSymbol].themeConfig.sourceColorArgb = sourceColorArgb
}
const themeSetContrastLevel = (d: Document & { [ContextSymbol]?: IContextData }, contrastLevel: number) => {
    d[ContextSymbol].themeConfig.contrastLevel = contrastLevel
}
const themeSetVariant = (d: Document & { [ContextSymbol]?: IContextData }, variant: number) => {
    d[ContextSymbol].themeConfig.variant = variant
}
const themeSetPrimaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, primaryPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.primaryPaletteArgb = primaryPaletteArgb
}
const themeSetSecondaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, secondaryPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.secondaryPaletteArgb = secondaryPaletteArgb
}
const themeSetTertiaryPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, tertiaryPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.tertiaryPaletteArgb = tertiaryPaletteArgb
}
const themeSetErrorPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, errorPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.errorPaletteArgb = errorPaletteArgb
}
const themeSetNeutralPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, neutralPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.neutralPaletteArgb = neutralPaletteArgb
}
const themeSetNeutralVariantPaletteArgb = (d: Document & { [ContextSymbol]?: IContextData }, neutralVariantPaletteArgb: number) => {
    d[ContextSymbol].themeConfig.neutralVariantPaletteArgb = neutralVariantPaletteArgb
}
const themeSetSpecVersion = (d: Document & { [ContextSymbol]?: IContextData }, specVersion: '2021' | '2025') => {
    d[ContextSymbol].themeConfig.specVersion = specVersion
}
const themeUpdate = (d: Document & { [ContextSymbol]?: IContextData }, themeConfig: Partial<IThemeConfig>) => {
    if (typeof themeConfig.isDark !== 'undefined' && themeConfig.isDark !== null) themeSetIsDark(d, themeConfig.isDark)
    if (typeof themeConfig.sourceColorArgb !== 'undefined' && themeConfig.sourceColorArgb !== null) themeSetSourceColorArgb(d, themeConfig.sourceColorArgb)
    if (typeof themeConfig.contrastLevel !== 'undefined' && themeConfig.contrastLevel !== null) themeSetContrastLevel(d, themeConfig.contrastLevel)
    if (typeof themeConfig.variant !== 'undefined' && themeConfig.variant !== null) themeSetVariant(d, themeConfig.variant)
    if (typeof themeConfig.primaryPaletteArgb !== 'undefined' && themeConfig.primaryPaletteArgb !== null) themeSetPrimaryPaletteArgb(d, themeConfig.primaryPaletteArgb)
    if (typeof themeConfig.secondaryPaletteArgb !== 'undefined' && themeConfig.secondaryPaletteArgb !== null) themeSetSecondaryPaletteArgb(d, themeConfig.secondaryPaletteArgb)
    if (typeof themeConfig.tertiaryPaletteArgb !== 'undefined' && themeConfig.tertiaryPaletteArgb !== null) themeSetTertiaryPaletteArgb(d, themeConfig.tertiaryPaletteArgb)
    if (typeof themeConfig.errorPaletteArgb !== 'undefined' && themeConfig.errorPaletteArgb !== null) themeSetErrorPaletteArgb(d, themeConfig.errorPaletteArgb)
    if (typeof themeConfig.neutralPaletteArgb !== 'undefined' && themeConfig.neutralPaletteArgb !== null) themeSetNeutralPaletteArgb(d, themeConfig.neutralPaletteArgb)
    if (typeof themeConfig.neutralVariantPaletteArgb !== 'undefined' && themeConfig.neutralVariantPaletteArgb !== null) themeSetNeutralVariantPaletteArgb(d, themeConfig.neutralVariantPaletteArgb)
    if (typeof themeConfig.specVersion !== 'undefined' && themeConfig.specVersion !== null) themeSetSpecVersion(d, themeConfig.specVersion)
}

const getThemeConfigFromLocalStorage = (key?: string): IThemeConfig => {
    const parsed = localStorage.getItem(key ?? DefaultLocalStorageKey)
    if (!parsed) throw new Error('No theme config found in local storage with key: ' + (key ?? DefaultLocalStorageKey))
    const themeConfig = JSON.parse(parsed) as unknown as IThemeConfig
    if (!isThemeConfig(themeConfig)) throw new Error('Invalid theme config in local storage')
    return themeConfig
}
const saveThemeConfigToLocalStorage = (themeConfig: IThemeConfig, key?: string) => {
    localStorage.setItem(key ?? DefaultLocalStorageKey, JSON.stringify(themeConfig))
}

const themeChangeToLight = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isDark = false
}
const themeChangeToDark = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isDark = true
}
const attrChangeToLight = () => {
    document.documentElement.removeAttribute('dark')
}
const attrChangeToDark = () => {
    document.documentElement.setAttribute('dark', '')
}


export function enhanceDocument() {
    if (typeof document === 'undefined') {
        throw new Error('This function can only be called in a browser environment.');
    }

    const d = document as Document & { [ContextSymbol]?: IContextData }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((d as any)[ContextSymbol]) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d as any)[ContextSymbol] = {}
    d[ContextSymbol].themeConfig = {} as unknown as IThemeConfig
    d[ContextSymbol].themeConfig.isDark = false
    d[ContextSymbol].themeConfig.sourceColorArgb = 0
    d[ContextSymbol].themeConfig.contrastLevel = 0
    d[ContextSymbol].themeConfig.variant = 4
    d[ContextSymbol].themeConfig.primaryPaletteArgb = 0
    d[ContextSymbol].themeConfig.secondaryPaletteArgb = 0
    d[ContextSymbol].themeConfig.tertiaryPaletteArgb = 0
    d[ContextSymbol].themeConfig.errorPaletteArgb = 0
    d[ContextSymbol].themeConfig.neutralPaletteArgb = 0
    d[ContextSymbol].themeConfig.neutralVariantPaletteArgb = 0
    d[ContextSymbol].themeConfig.specVersion = "2025"


    d[ContextSymbol].getIsDark = () => getIsDark(d)
    d[ContextSymbol].setIsDark = (isDark: boolean) => themeSetIsDark(d, isDark)
    d[ContextSymbol].getSourceColorArgb = () => getSourceColorArgb(d)
    d[ContextSymbol].setSourceColorArgb = (sourceColorArgb: number) => themeSetSourceColorArgb(d, sourceColorArgb)
    d[ContextSymbol].getContrastLevel = () => getContrastLevel(d)
    d[ContextSymbol].setContrastLevel = (contrastLevel: number) => themeSetContrastLevel(d, contrastLevel)
    d[ContextSymbol].getVariant = () => getVariant(d)
    d[ContextSymbol].setVariant = (variant: number) => themeSetVariant(d, variant)
    d[ContextSymbol].getPrimaryPaletteArgb = () => getPrimaryPaletteArgb(d)
    d[ContextSymbol].setPrimaryPaletteArgb = (primaryPaletteArgb: number) => themeSetPrimaryPaletteArgb(d, primaryPaletteArgb)
    d[ContextSymbol].getSecondaryPaletteArgb = () => getSecondaryPaletteArgb(d)
    d[ContextSymbol].setSecondaryPaletteArgb = (secondaryPaletteArgb: number) => themeSetSecondaryPaletteArgb(d, secondaryPaletteArgb)
    d[ContextSymbol].getTertiaryPaletteArgb = () => getTertiaryPaletteArgb(d)
    d[ContextSymbol].setTertiaryPaletteArgb = (tertiaryPaletteArgb: number) => themeSetTertiaryPaletteArgb(d, tertiaryPaletteArgb)
    d[ContextSymbol].getErrorPaletteArgb = () => getErrorPaletteArgb(d)
    d[ContextSymbol].setErrorPaletteArgb = (errorPaletteArgb: number) => themeSetErrorPaletteArgb(d, errorPaletteArgb)
    d[ContextSymbol].getNeutralPaletteArgb = () => getNeutralPaletteArgb(d)
    d[ContextSymbol].setNeutralPaletteArgb = (neutralPaletteArgb: number) => themeSetNeutralPaletteArgb(d, neutralPaletteArgb)
    d[ContextSymbol].getNeutralVariantPaletteArgb = () => getNeutralVariantPaletteArgb(d)
    d[ContextSymbol].setNeutralVariantPaletteArgb = (neutralVariantPaletteArgb: number) => themeSetNeutralVariantPaletteArgb(d, neutralVariantPaletteArgb)
    d[ContextSymbol].getSpecVersion = () => getSpecVersion(d)
    d[ContextSymbol].setSpecVersion = (specVersion: '2021' | '2025') => themeSetSpecVersion(d, specVersion)

    d[ContextSymbol].isThemeConfig = (obj: any): obj is IThemeConfig => isThemeConfig(obj)

    d[ContextSymbol].themeChangeToLight = () => themeChangeToLight(d)
    d[ContextSymbol].themeChangeToDark = () => themeChangeToDark(d)
    d[ContextSymbol].attrChangeToLight = () => attrChangeToLight()
    d[ContextSymbol].attrChangeToDark = () => attrChangeToDark()

    d[ContextSymbol].getThemeConfigFromLocalStorage = (key?: string) => getThemeConfigFromLocalStorage(key)
    d[ContextSymbol].saveThemeConfigToLocalStorage = (themeConfig: IThemeConfig, key?: string) => saveThemeConfigToLocalStorage(themeConfig, key)

    d.addEventListener('theme:init-from-local-storage', (e) => {
        const detail = e.detail
        const themeConfig = getThemeConfigFromLocalStorage(detail?.key ?? DefaultLocalStorageKey)
        d[ContextSymbol].themeConfig = themeConfig
    })
    d.addEventListener('theme:save-changes', (e) => {
        const detail = e.detail
        saveThemeConfigToLocalStorage(d[ContextSymbol].themeConfig, detail?.key ?? DefaultLocalStorageKey)
    })

    d.addEventListener('attr:change-to-light', () => {
        attrChangeToLight()
    })
    d.addEventListener('attr:change-to-dark', () => {
        attrChangeToDark()
    })

    d.addEventListener('theme:change-to-light', () => {
        themeChangeToLight(d)
    })
    d.addEventListener('theme:change-to-dark', () => {
        themeChangeToDark(d)
    })

    d.addEventListener('theme:change', (e) => {
        if (e.detail != null) themeUpdate(d, e.detail)
    })


}
