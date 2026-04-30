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
        typeof obj?.specVersion === 'string' &&
        typeof obj?.isPrimaryPaletteEnabled === 'boolean' &&
        typeof obj?.isSecondaryPaletteEnabled === 'boolean' &&
        typeof obj?.isTertiaryPaletteEnabled === 'boolean' &&
        typeof obj?.isErrorPaletteEnabled === 'boolean' &&
        typeof obj?.isNeutralPaletteEnabled === 'boolean' &&
        typeof obj?.isNeutralVariantPaletteEnabled === 'boolean'
    )
}
const themeToggleIsDark = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isDark = !d[ContextSymbol].themeConfig.isDark
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

const getIsPrimaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isPrimaryPaletteEnabled === 'undefined') throw new Error('isPrimaryPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled
}
const getIsSecondaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isSecondaryPaletteEnabled === 'undefined') throw new Error('isSecondaryPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled
}
const getIsTertiaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isTertiaryPaletteEnabled === 'undefined') throw new Error('isTertiaryPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled
}
const getIsErrorPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isErrorPaletteEnabled === 'undefined') throw new Error('isErrorPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isErrorPaletteEnabled
}
const getIsNeutralPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isNeutralPaletteEnabled === 'undefined') throw new Error('isNeutralPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isNeutralPaletteEnabled
}
const getIsNeutralVariantPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }): boolean => {
    if (typeof d[ContextSymbol]?.themeConfig.isNeutralVariantPaletteEnabled === 'undefined') throw new Error('isNeutralVariantPaletteEnabled is undefined in themeConfig')
    return d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled
}

const themeSetIsPrimaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled = enabled
}
const themeSetIsSecondaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled = enabled
}
const themeSetIsTertiaryPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled = enabled
}
const themeSetIsErrorPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isErrorPaletteEnabled = enabled
}
const themeSetIsNeutralPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isNeutralPaletteEnabled = enabled
}
const themeSetIsNeutralVariantPaletteEnabled = (d: Document & { [ContextSymbol]?: IContextData }, enabled: boolean) => {
    d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled = enabled
}

const themeTogglePrimaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled = !d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled
}
const themeToggleSecondaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled = !d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled
}
const themeToggleTertiaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled = !d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled
}
const themeToggleErrorPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isErrorPaletteEnabled = !d[ContextSymbol].themeConfig.isErrorPaletteEnabled
}
const themeToggleNeutralPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralPaletteEnabled = !d[ContextSymbol].themeConfig.isNeutralPaletteEnabled
}
const themeToggleNeutralVariantPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled = !d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled
}

const themeEnablePrimaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled = true
}
const themeDisablePrimaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled = false
}
const themeEnableSecondaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled = true
}
const themeDisableSecondaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled = false
}
const themeEnableTertiaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled = true
}
const themeDisableTertiaryPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled = false
}
const themeEnableErrorPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isErrorPaletteEnabled = true
}
const themeDisableErrorPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isErrorPaletteEnabled = false
}
const themeEnableNeutralPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralPaletteEnabled = true
}
const themeDisableNeutralPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralPaletteEnabled = false
}
const themeEnableNeutralVariantPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled = true
}
const themeDisableNeutralVariantPalette = (d: Document & { [ContextSymbol]?: IContextData }) => {
    d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled = false
}

const themeChange = (d: Document & { [ContextSymbol]?: IContextData }, themeConfig: Partial<IThemeConfig>) => {
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
    if (typeof themeConfig.isPrimaryPaletteEnabled !== 'undefined' && themeConfig.isPrimaryPaletteEnabled !== null) themeSetIsPrimaryPaletteEnabled(d, themeConfig.isPrimaryPaletteEnabled)
    if (typeof themeConfig.isSecondaryPaletteEnabled !== 'undefined' && themeConfig.isSecondaryPaletteEnabled !== null) themeSetIsSecondaryPaletteEnabled(d, themeConfig.isSecondaryPaletteEnabled)
    if (typeof themeConfig.isTertiaryPaletteEnabled !== 'undefined' && themeConfig.isTertiaryPaletteEnabled !== null) themeSetIsTertiaryPaletteEnabled(d, themeConfig.isTertiaryPaletteEnabled)
    if (typeof themeConfig.isErrorPaletteEnabled !== 'undefined' && themeConfig.isErrorPaletteEnabled !== null) themeSetIsErrorPaletteEnabled(d, themeConfig.isErrorPaletteEnabled)
    if (typeof themeConfig.isNeutralPaletteEnabled !== 'undefined' && themeConfig.isNeutralPaletteEnabled !== null) themeSetIsNeutralPaletteEnabled(d, themeConfig.isNeutralPaletteEnabled)
    if (typeof themeConfig.isNeutralVariantPaletteEnabled !== 'undefined' && themeConfig.isNeutralVariantPaletteEnabled !== null) themeSetIsNeutralVariantPaletteEnabled(d, themeConfig.isNeutralVariantPaletteEnabled)
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
const getIsDarkAttr = (): boolean => {
    return document.documentElement.hasAttribute('dark')
}
const setIsDarkAttr = (isDark: boolean) => {
    if (isDark) document.documentElement.setAttribute('dark', '')
    else document.documentElement.removeAttribute('dark')
}

const setSpecVersionAttr = (specVersion: '2021' | '2025') => {
    document.documentElement.setAttribute('spec-version', specVersion)
}
const getSpecVersionAttr = (): string | null => {
    return document.documentElement.getAttribute('spec-version')
}

const setPrimaryPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('primary-palette-argb', String(argb))
}
const getPrimaryPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('primary-palette-argb')
    return val !== null ? Number(val) : null
}
const setSecondaryPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('secondary-palette-argb', String(argb))
}
const getSecondaryPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('secondary-palette-argb')
    return val !== null ? Number(val) : null
}
const setTertiaryPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('tertiary-palette-argb', String(argb))
}
const getTertiaryPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('tertiary-palette-argb')
    return val !== null ? Number(val) : null
}
const setErrorPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('error-palette-argb', String(argb))
}
const getErrorPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('error-palette-argb')
    return val !== null ? Number(val) : null
}
const setNeutralPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('neutral-palette-argb', String(argb))
}
const getNeutralPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('neutral-palette-argb')
    return val !== null ? Number(val) : null
}
const setNeutralVariantPaletteArgbAttr = (argb: number) => {
    document.documentElement.setAttribute('neutral-variant-palette-argb', String(argb))
}
const getNeutralVariantPaletteArgbAttr = (): number | null => {
    const val = document.documentElement.getAttribute('neutral-variant-palette-argb')
    return val !== null ? Number(val) : null
}

const enablePrimaryPaletteAttr = () => {
    document.documentElement.setAttribute('primary-palette', '')
}
const disablePrimaryPaletteAttr = () => {
    document.documentElement.removeAttribute('primary-palette')
}
const getIsPrimaryPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('primary-palette')
}
const enableSecondaryPaletteAttr = () => {
    document.documentElement.setAttribute('secondary-palette', '')
}
const disableSecondaryPaletteAttr = () => {
    document.documentElement.removeAttribute('secondary-palette')
}
const getIsSecondaryPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('secondary-palette')
}
const enableTertiaryPaletteAttr = () => {
    document.documentElement.setAttribute('tertiary-palette', '')
}
const disableTertiaryPaletteAttr = () => {
    document.documentElement.removeAttribute('tertiary-palette')
}
const getIsTertiaryPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('tertiary-palette')
}
const enableErrorPaletteAttr = () => {
    document.documentElement.setAttribute('error-palette', '')
}
const disableErrorPaletteAttr = () => {
    document.documentElement.removeAttribute('error-palette')
}
const getIsErrorPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('error-palette')
}
const enableNeutralPaletteAttr = () => {
    document.documentElement.setAttribute('neutral-palette', '')
}
const disableNeutralPaletteAttr = () => {
    document.documentElement.removeAttribute('neutral-palette')
}
const getIsNeutralPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('neutral-palette')
}
const enableNeutralVariantPaletteAttr = () => {
    document.documentElement.setAttribute('neutral-variant-palette', '')
}
const disableNeutralVariantPaletteAttr = () => {
    document.documentElement.removeAttribute('neutral-variant-palette')
}
const getIsNeutralVariantPaletteEnabledAttr = (): boolean => {
    return document.documentElement.hasAttribute('neutral-variant-palette')
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
    d[ContextSymbol].themeConfig.sourceColorArgb = 4278221266
    d[ContextSymbol].themeConfig.contrastLevel = 0
    d[ContextSymbol].themeConfig.variant = 2
    d[ContextSymbol].themeConfig.primaryPaletteArgb = 4283007595
    d[ContextSymbol].themeConfig.secondaryPaletteArgb = 4287133460
    d[ContextSymbol].themeConfig.tertiaryPaletteArgb = 4289815094
    d[ContextSymbol].themeConfig.errorPaletteArgb = 4293329021
    d[ContextSymbol].themeConfig.neutralPaletteArgb = 4284448117
    d[ContextSymbol].themeConfig.neutralVariantPaletteArgb = 4285364854
    d[ContextSymbol].themeConfig.specVersion = "2025"
    d[ContextSymbol].themeConfig.isPrimaryPaletteEnabled = true
    d[ContextSymbol].themeConfig.isSecondaryPaletteEnabled = true
    d[ContextSymbol].themeConfig.isTertiaryPaletteEnabled = true
    d[ContextSymbol].themeConfig.isErrorPaletteEnabled = true
    d[ContextSymbol].themeConfig.isNeutralPaletteEnabled = true
    d[ContextSymbol].themeConfig.isNeutralVariantPaletteEnabled = true


    d[ContextSymbol].getIsDark = () => getIsDark(d)
    d[ContextSymbol].setIsDark = (isDark: boolean) => themeSetIsDark(d, isDark)
    d[ContextSymbol].toggleIsDark = () => themeToggleIsDark(d)
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
    d[ContextSymbol].getIsDarkAttr = () => getIsDarkAttr()
    d[ContextSymbol].setIsDarkAttr = (isDark: boolean) => setIsDarkAttr(isDark)
    d[ContextSymbol].setSpecVersionAttr = (specVersion: '2021' | '2025') => setSpecVersionAttr(specVersion)
    d[ContextSymbol].getSpecVersionAttr = () => getSpecVersionAttr()
    d[ContextSymbol].setPrimaryPaletteArgbAttr = (argb: number) => setPrimaryPaletteArgbAttr(argb)
    d[ContextSymbol].getPrimaryPaletteArgbAttr = () => getPrimaryPaletteArgbAttr()
    d[ContextSymbol].setSecondaryPaletteArgbAttr = (argb: number) => setSecondaryPaletteArgbAttr(argb)
    d[ContextSymbol].getSecondaryPaletteArgbAttr = () => getSecondaryPaletteArgbAttr()
    d[ContextSymbol].setTertiaryPaletteArgbAttr = (argb: number) => setTertiaryPaletteArgbAttr(argb)
    d[ContextSymbol].getTertiaryPaletteArgbAttr = () => getTertiaryPaletteArgbAttr()
    d[ContextSymbol].setErrorPaletteArgbAttr = (argb: number) => setErrorPaletteArgbAttr(argb)
    d[ContextSymbol].getErrorPaletteArgbAttr = () => getErrorPaletteArgbAttr()
    d[ContextSymbol].setNeutralPaletteArgbAttr = (argb: number) => setNeutralPaletteArgbAttr(argb)
    d[ContextSymbol].getNeutralPaletteArgbAttr = () => getNeutralPaletteArgbAttr()
    d[ContextSymbol].setNeutralVariantPaletteArgbAttr = (argb: number) => setNeutralVariantPaletteArgbAttr(argb)
    d[ContextSymbol].getNeutralVariantPaletteArgbAttr = () => getNeutralVariantPaletteArgbAttr()
    d[ContextSymbol].enablePrimaryPaletteAttr = () => enablePrimaryPaletteAttr()
    d[ContextSymbol].disablePrimaryPaletteAttr = () => disablePrimaryPaletteAttr()
    d[ContextSymbol].getIsPrimaryPaletteEnabledAttr = () => getIsPrimaryPaletteEnabledAttr()
    d[ContextSymbol].enableSecondaryPaletteAttr = () => enableSecondaryPaletteAttr()
    d[ContextSymbol].disableSecondaryPaletteAttr = () => disableSecondaryPaletteAttr()
    d[ContextSymbol].getIsSecondaryPaletteEnabledAttr = () => getIsSecondaryPaletteEnabledAttr()
    d[ContextSymbol].enableTertiaryPaletteAttr = () => enableTertiaryPaletteAttr()
    d[ContextSymbol].disableTertiaryPaletteAttr = () => disableTertiaryPaletteAttr()
    d[ContextSymbol].getIsTertiaryPaletteEnabledAttr = () => getIsTertiaryPaletteEnabledAttr()
    d[ContextSymbol].enableErrorPaletteAttr = () => enableErrorPaletteAttr()
    d[ContextSymbol].disableErrorPaletteAttr = () => disableErrorPaletteAttr()
    d[ContextSymbol].getIsErrorPaletteEnabledAttr = () => getIsErrorPaletteEnabledAttr()
    d[ContextSymbol].enableNeutralPaletteAttr = () => enableNeutralPaletteAttr()
    d[ContextSymbol].disableNeutralPaletteAttr = () => disableNeutralPaletteAttr()
    d[ContextSymbol].getIsNeutralPaletteEnabledAttr = () => getIsNeutralPaletteEnabledAttr()
    d[ContextSymbol].enableNeutralVariantPaletteAttr = () => enableNeutralVariantPaletteAttr()
    d[ContextSymbol].disableNeutralVariantPaletteAttr = () => disableNeutralVariantPaletteAttr()
    d[ContextSymbol].getIsNeutralVariantPaletteEnabledAttr = () => getIsNeutralVariantPaletteEnabledAttr()

    d[ContextSymbol].getThemeConfigFromLocalStorage = (key?: string) => getThemeConfigFromLocalStorage(key)
    d[ContextSymbol].saveThemeConfigToLocalStorage = (themeConfig: IThemeConfig, key?: string) => saveThemeConfigToLocalStorage(themeConfig, key)
    d[ContextSymbol].themeChange = (themeConfig: Partial<IThemeConfig>) => themeChange(d, themeConfig)

    d[ContextSymbol].getIsPrimaryPaletteEnabled = () => getIsPrimaryPaletteEnabled(d)
    d[ContextSymbol].setIsPrimaryPaletteEnabled = (enabled: boolean) => themeSetIsPrimaryPaletteEnabled(d, enabled)
    d[ContextSymbol].enablePrimaryPalette = () => themeEnablePrimaryPalette(d)
    d[ContextSymbol].disablePrimaryPalette = () => themeDisablePrimaryPalette(d)
    d[ContextSymbol].togglePrimaryPalette = () => themeTogglePrimaryPalette(d)
    d[ContextSymbol].getIsSecondaryPaletteEnabled = () => getIsSecondaryPaletteEnabled(d)
    d[ContextSymbol].setIsSecondaryPaletteEnabled = (enabled: boolean) => themeSetIsSecondaryPaletteEnabled(d, enabled)
    d[ContextSymbol].enableSecondaryPalette = () => themeEnableSecondaryPalette(d)
    d[ContextSymbol].disableSecondaryPalette = () => themeDisableSecondaryPalette(d)
    d[ContextSymbol].toggleSecondaryPalette = () => themeToggleSecondaryPalette(d)
    d[ContextSymbol].getIsTertiaryPaletteEnabled = () => getIsTertiaryPaletteEnabled(d)
    d[ContextSymbol].setIsTertiaryPaletteEnabled = (enabled: boolean) => themeSetIsTertiaryPaletteEnabled(d, enabled)
    d[ContextSymbol].enableTertiaryPalette = () => themeEnableTertiaryPalette(d)
    d[ContextSymbol].disableTertiaryPalette = () => themeDisableTertiaryPalette(d)
    d[ContextSymbol].toggleTertiaryPalette = () => themeToggleTertiaryPalette(d)
    d[ContextSymbol].getIsErrorPaletteEnabled = () => getIsErrorPaletteEnabled(d)
    d[ContextSymbol].setIsErrorPaletteEnabled = (enabled: boolean) => themeSetIsErrorPaletteEnabled(d, enabled)
    d[ContextSymbol].enableErrorPalette = () => themeEnableErrorPalette(d)
    d[ContextSymbol].disableErrorPalette = () => themeDisableErrorPalette(d)
    d[ContextSymbol].toggleErrorPalette = () => themeToggleErrorPalette(d)
    d[ContextSymbol].getIsNeutralPaletteEnabled = () => getIsNeutralPaletteEnabled(d)
    d[ContextSymbol].setIsNeutralPaletteEnabled = (enabled: boolean) => themeSetIsNeutralPaletteEnabled(d, enabled)
    d[ContextSymbol].enableNeutralPalette = () => themeEnableNeutralPalette(d)
    d[ContextSymbol].disableNeutralPalette = () => themeDisableNeutralPalette(d)
    d[ContextSymbol].toggleNeutralPalette = () => themeToggleNeutralPalette(d)
    d[ContextSymbol].getIsNeutralVariantPaletteEnabled = () => getIsNeutralVariantPaletteEnabled(d)
    d[ContextSymbol].setIsNeutralVariantPaletteEnabled = (enabled: boolean) => themeSetIsNeutralVariantPaletteEnabled(d, enabled)
    d[ContextSymbol].enableNeutralVariantPalette = () => themeEnableNeutralVariantPalette(d)
    d[ContextSymbol].disableNeutralVariantPalette = () => themeDisableNeutralVariantPalette(d)
    d[ContextSymbol].toggleNeutralVariantPalette = () => themeToggleNeutralVariantPalette(d)

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
        if (e.detail != null) themeChange(d, e.detail)
    })

    d.addEventListener('theme:set-is-dark', (e) => {
        if (e.detail != null) themeSetIsDark(d, e.detail.isDark)
    })
    d.addEventListener('theme:set-source-color-argb', (e) => {
        if (e.detail != null) themeSetSourceColorArgb(d, e.detail.sourceColorArgb)
    })
    d.addEventListener('theme:set-contrast-level', (e) => {
        if (e.detail != null) themeSetContrastLevel(d, e.detail.contrastLevel)
    })
    d.addEventListener('theme:set-variant', (e) => {
        if (e.detail != null) themeSetVariant(d, e.detail.variant)
    })
    d.addEventListener('theme:set-primary-palette-argb', (e) => {
        if (e.detail != null) themeSetPrimaryPaletteArgb(d, e.detail.primaryPaletteArgb)
    })
    d.addEventListener('theme:set-secondary-palette-argb', (e) => {
        if (e.detail != null) themeSetSecondaryPaletteArgb(d, e.detail.secondaryPaletteArgb)
    })
    d.addEventListener('theme:set-tertiary-palette-argb', (e) => {
        if (e.detail != null) themeSetTertiaryPaletteArgb(d, e.detail.tertiaryPaletteArgb)
    })
    d.addEventListener('theme:set-error-palette-argb', (e) => {
        if (e.detail != null) themeSetErrorPaletteArgb(d, e.detail.errorPaletteArgb)
    })
    d.addEventListener('theme:set-neutral-palette-argb', (e) => {
        if (e.detail != null) themeSetNeutralPaletteArgb(d, e.detail.neutralPaletteArgb)
    })
    d.addEventListener('theme:set-neutral-variant-palette-argb', (e) => {
        if (e.detail != null) themeSetNeutralVariantPaletteArgb(d, e.detail.neutralVariantPaletteArgb)
    })
    d.addEventListener('theme:set-spec-version', (e) => {
        if (e.detail != null) themeSetSpecVersion(d, e.detail.specVersion)
    })

    d.addEventListener('theme:toggle-primary-palette', () => {
        themeTogglePrimaryPalette(d)
    })
    d.addEventListener('theme:toggle-secondary-palette', () => {
        themeToggleSecondaryPalette(d)
    })
    d.addEventListener('theme:toggle-tertiary-palette', () => {
        themeToggleTertiaryPalette(d)
    })
    d.addEventListener('theme:toggle-error-palette', () => {
        themeToggleErrorPalette(d)
    })
    d.addEventListener('theme:toggle-neutral-palette', () => {
        themeToggleNeutralPalette(d)
    })
    d.addEventListener('theme:toggle-neutral-variant-palette', () => {
        themeToggleNeutralVariantPalette(d)
    })

    d.addEventListener('theme:set-primary-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsPrimaryPaletteEnabled(d, e.detail.isPrimaryPaletteEnabled)
    })
    d.addEventListener('theme:set-secondary-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsSecondaryPaletteEnabled(d, e.detail.isSecondaryPaletteEnabled)
    })
    d.addEventListener('theme:set-tertiary-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsTertiaryPaletteEnabled(d, e.detail.isTertiaryPaletteEnabled)
    })
    d.addEventListener('theme:set-error-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsErrorPaletteEnabled(d, e.detail.isErrorPaletteEnabled)
    })
    d.addEventListener('theme:set-neutral-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsNeutralPaletteEnabled(d, e.detail.isNeutralPaletteEnabled)
    })
    d.addEventListener('theme:set-neutral-variant-palette-enabled', (e) => {
        if (e.detail != null) themeSetIsNeutralVariantPaletteEnabled(d, e.detail.isNeutralVariantPaletteEnabled)
    })

    d.addEventListener('theme:toggle-is-dark', () => {
        themeToggleIsDark(d)
    })

    d.addEventListener('theme:enable-primary-palette', () => {
        themeEnablePrimaryPalette(d)
    })
    d.addEventListener('theme:disable-primary-palette', () => {
        themeDisablePrimaryPalette(d)
    })
    d.addEventListener('theme:enable-secondary-palette', () => {
        themeEnableSecondaryPalette(d)
    })
    d.addEventListener('theme:disable-secondary-palette', () => {
        themeDisableSecondaryPalette(d)
    })
    d.addEventListener('theme:enable-tertiary-palette', () => {
        themeEnableTertiaryPalette(d)
    })
    d.addEventListener('theme:disable-tertiary-palette', () => {
        themeDisableTertiaryPalette(d)
    })
    d.addEventListener('theme:enable-error-palette', () => {
        themeEnableErrorPalette(d)
    })
    d.addEventListener('theme:disable-error-palette', () => {
        themeDisableErrorPalette(d)
    })
    d.addEventListener('theme:enable-neutral-palette', () => {
        themeEnableNeutralPalette(d)
    })
    d.addEventListener('theme:disable-neutral-palette', () => {
        themeDisableNeutralPalette(d)
    })
    d.addEventListener('theme:enable-neutral-variant-palette', () => {
        themeEnableNeutralVariantPalette(d)
    })
    d.addEventListener('theme:disable-neutral-variant-palette', () => {
        themeDisableNeutralVariantPalette(d)
    })

    d.addEventListener('attr:set-is-dark', (e) => {
        if (e.detail != null) setIsDarkAttr(e.detail.isDark)
    })

    d.addEventListener('attr:set-spec-version', (e) => {
        if (e.detail != null) setSpecVersionAttr(e.detail.specVersion)
    })
    d.addEventListener('attr:set-primary-palette-argb', (e) => {
        if (e.detail != null) setPrimaryPaletteArgbAttr(e.detail.primaryPaletteArgb)
    })
    d.addEventListener('attr:set-secondary-palette-argb', (e) => {
        if (e.detail != null) setSecondaryPaletteArgbAttr(e.detail.secondaryPaletteArgb)
    })
    d.addEventListener('attr:set-tertiary-palette-argb', (e) => {
        if (e.detail != null) setTertiaryPaletteArgbAttr(e.detail.tertiaryPaletteArgb)
    })
    d.addEventListener('attr:set-error-palette-argb', (e) => {
        if (e.detail != null) setErrorPaletteArgbAttr(e.detail.errorPaletteArgb)
    })
    d.addEventListener('attr:set-neutral-palette-argb', (e) => {
        if (e.detail != null) setNeutralPaletteArgbAttr(e.detail.neutralPaletteArgb)
    })
    d.addEventListener('attr:set-neutral-variant-palette-argb', (e) => {
        if (e.detail != null) setNeutralVariantPaletteArgbAttr(e.detail.neutralVariantPaletteArgb)
    })
    d.addEventListener('attr:enable-primary-palette', () => {
        enablePrimaryPaletteAttr()
    })
    d.addEventListener('attr:disable-primary-palette', () => {
        disablePrimaryPaletteAttr()
    })
    d.addEventListener('attr:enable-secondary-palette', () => {
        enableSecondaryPaletteAttr()
    })
    d.addEventListener('attr:disable-secondary-palette', () => {
        disableSecondaryPaletteAttr()
    })
    d.addEventListener('attr:enable-tertiary-palette', () => {
        enableTertiaryPaletteAttr()
    })
    d.addEventListener('attr:disable-tertiary-palette', () => {
        disableTertiaryPaletteAttr()
    })
    d.addEventListener('attr:enable-error-palette', () => {
        enableErrorPaletteAttr()
    })
    d.addEventListener('attr:disable-error-palette', () => {
        disableErrorPaletteAttr()
    })
    d.addEventListener('attr:enable-neutral-palette', () => {
        enableNeutralPaletteAttr()
    })
    d.addEventListener('attr:disable-neutral-palette', () => {
        disableNeutralPaletteAttr()
    })
    d.addEventListener('attr:enable-neutral-variant-palette', () => {
        enableNeutralVariantPaletteAttr()
    })
    d.addEventListener('attr:disable-neutral-variant-palette', () => {
        disableNeutralVariantPaletteAttr()
    })


}
