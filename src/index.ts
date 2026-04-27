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
            getSourceColorArgb: () => number
            setSourceColorArgb: (argb: number) => void
            getContrastLevel: () => number
            setContrastLevel: (contrastLevel: number) => void
            getVariant: () => number
            setVariant: (variant: number) => void
            getPrimaryPaletteArgb: () => number
            setPrimaryPaletteArgb: (argb: number) => void
            getSecondaryPaletteArgb: () => number
            setSecondaryPaletteArgb: (argb: number) => void
            getTertiaryPaletteArgb: () => number
            setTertiaryPaletteArgb: (argb: number) => void
            getErrorPaletteArgb: () => number
            setErrorPaletteArgb: (argb: number) => void
            getNeutralPaletteArgb: () => number
            setNeutralPaletteArgb: (argb: number) => void
            getNeutralVariantPaletteArgb: () => number
            setNeutralVariantPaletteArgb: (argb: number) => void
            getSpecVersion: () => string
            setSpecVersion: (specVersion: '2021' | '2025') => void

            isThemeConfig: (obj: any) => obj is IThemeConfig
            themeChangeToLight: () => void
            themeChangeToDark: () => void
            attrChangeToLight: () => void
            attrChangeToDark: () => void
            getThemeConfigFromLocalStorage: (key?: string) => IThemeConfig
            saveThemeConfigToLocalStorage: (themeConfig: IThemeConfig, key?: string) => void
        }

    }

    interface DocumentEventMap extends ICustomEventMap { }
}

export * from './enhance-document';
export * from './event-map';
export * from './theme-config';
