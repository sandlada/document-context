export interface IThemeConfig {
    isDark: boolean
    sourceColorArgb: number
    contrastLevel: (number & {}) | -1 | 0 | 1
    variant: number
    primaryPaletteArgb: number
    secondaryPaletteArgb: number
    tertiaryPaletteArgb: number
    errorPaletteArgb: number
    neutralPaletteArgb: number
    neutralVariantPaletteArgb: number
    specVersion: "2021" | "2025"
    isPrimaryPaletteEnabled: boolean
    isSecondaryPaletteEnabled: boolean
    isTertiaryPaletteEnabled: boolean
    isErrorPaletteEnabled: boolean
    isNeutralPaletteEnabled: boolean
    isNeutralVariantPaletteEnabled: boolean
}
