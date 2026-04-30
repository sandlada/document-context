import { ContextSymbol } from "./enhance-document";
import type { ICustomEventMap } from "./event-map";
import type { IThemeConfig } from "./theme-config";

declare global {
    interface Document {
        enhanceDocument?: () => void

        [ContextSymbol]: {
            themeConfig: IThemeConfig

            getIsDark: () => boolean
            setIsDark: (isDark: boolean) => void
            toggleIsDark: () => void
            getIsDarkAttr: () => boolean
            setIsDarkAttr: (isDark: boolean) => void

            getSourceColorArgb: () => number
            setSourceColorArgb: (argb: number) => void

            getContrastLevel: () => number
            setContrastLevel: (contrastLevel: number) => void

            getVariant: () => number
            setVariant: (variant: number) => void

            getSpecVersion: () => string
            setSpecVersion: (specVersion: '2021' | '2025') => void
            setSpecVersionAttr: (specVersion: '2021' | '2025') => void
            getSpecVersionAttr: () => string | null

            getPrimaryPaletteArgb: () => number
            setPrimaryPaletteArgb: (argb: number) => void
            setPrimaryPaletteArgbAttr: (argb: number) => void
            getPrimaryPaletteArgbAttr: () => number | null

            getSecondaryPaletteArgb: () => number
            setSecondaryPaletteArgbAttr: (argb: number) => void
            getSecondaryPaletteArgbAttr: () => number | null
            setSecondaryPaletteArgb: (argb: number) => void

            getTertiaryPaletteArgb: () => number
            setTertiaryPaletteArgb: (argb: number) => void
            setTertiaryPaletteArgbAttr: (argb: number) => void
            getTertiaryPaletteArgbAttr: () => number | null

            getErrorPaletteArgb: () => number
            setErrorPaletteArgb: (argb: number) => void
            setErrorPaletteArgbAttr: (argb: number) => void
            getErrorPaletteArgbAttr: () => number | null

            getNeutralPaletteArgb: () => number
            setNeutralPaletteArgb: (argb: number) => void
            setNeutralPaletteArgbAttr: (argb: number) => void
            getNeutralPaletteArgbAttr: () => number | null

            getNeutralVariantPaletteArgb: () => number
            setNeutralVariantPaletteArgb: (argb: number) => void
            setNeutralVariantPaletteArgbAttr: (argb: number) => void
            getNeutralVariantPaletteArgbAttr: () => number | null

            getIsPrimaryPaletteEnabled: () => boolean
            setIsPrimaryPaletteEnabled: (enabled: boolean) => void
            enablePrimaryPalette: () => void
            disablePrimaryPalette: () => void
            togglePrimaryPalette: () => void
            enablePrimaryPaletteAttr: () => void
            disablePrimaryPaletteAttr: () => void
            getIsPrimaryPaletteEnabledAttr: () => boolean

            getIsSecondaryPaletteEnabled: () => boolean
            setIsSecondaryPaletteEnabled: (enabled: boolean) => void
            enableSecondaryPalette: () => void
            disableSecondaryPalette: () => void
            toggleSecondaryPalette: () => void
            enableSecondaryPaletteAttr: () => void
            disableSecondaryPaletteAttr: () => void
            getIsSecondaryPaletteEnabledAttr: () => boolean

            getIsTertiaryPaletteEnabled: () => boolean
            setIsTertiaryPaletteEnabled: (enabled: boolean) => void
            enableTertiaryPalette: () => void
            disableTertiaryPalette: () => void
            toggleTertiaryPalette: () => void
            enableTertiaryPaletteAttr: () => void
            disableTertiaryPaletteAttr: () => void
            getIsTertiaryPaletteEnabledAttr: () => boolean

            getIsErrorPaletteEnabled: () => boolean
            setIsErrorPaletteEnabled: (enabled: boolean) => void
            enableErrorPalette: () => void
            disableErrorPalette: () => void
            toggleErrorPalette: () => void
            enableErrorPaletteAttr: () => void
            disableErrorPaletteAttr: () => void
            getIsErrorPaletteEnabledAttr: () => boolean

            getIsNeutralPaletteEnabled: () => boolean
            setIsNeutralPaletteEnabled: (enabled: boolean) => void
            enableNeutralPalette: () => void
            disableNeutralPalette: () => void
            toggleNeutralPalette: () => void
            enableNeutralPaletteAttr: () => void
            disableNeutralPaletteAttr: () => void
            getIsNeutralPaletteEnabledAttr: () => boolean

            getIsNeutralVariantPaletteEnabled: () => boolean
            setIsNeutralVariantPaletteEnabled: (enabled: boolean) => void
            enableNeutralVariantPalette: () => void
            disableNeutralVariantPalette: () => void
            toggleNeutralVariantPalette: () => void
            enableNeutralVariantPaletteAttr: () => void
            disableNeutralVariantPaletteAttr: () => void
            getIsNeutralVariantPaletteEnabledAttr: () => boolean

            isThemeConfig: (obj: any) => obj is IThemeConfig

            themeChangeToLight: () => void
            themeChangeToDark: () => void
            attrChangeToLight: () => void
            attrChangeToDark: () => void

            getThemeConfigFromLocalStorage: (key?: string) => IThemeConfig
            saveThemeConfigToLocalStorage: (themeConfig: IThemeConfig, key?: string) => void
            themeChange: (themeConfig: Partial<IThemeConfig>) => void

        }

    }

    interface DocumentEventMap extends ICustomEventMap { }
}

export * from './enhance-document';
export * from './event-map';
export * from './theme-config';
