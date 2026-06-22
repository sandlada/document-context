export type ContrastLevel = (number & {}) | -1 | 0 | 1
export type SpecVersion = '2021' | '2025'

export interface IThemeRaw {
    isDark: boolean
    sourceColorArgb: number
    contrastLevel: ContrastLevel
    variant: number
    primaryPaletteArgb: number
    secondaryPaletteArgb: number
    tertiaryPaletteArgb: number
    errorPaletteArgb: number
    neutralPaletteArgb: number
    neutralVariantPaletteArgb: number
    specVersion: SpecVersion
    isPrimaryPaletteEnabled: boolean
    isSecondaryPaletteEnabled: boolean
    isTertiaryPaletteEnabled: boolean
    isErrorPaletteEnabled: boolean
    isNeutralPaletteEnabled: boolean
    isNeutralVariantPaletteEnabled: boolean
}

export class ThemeEntity implements IThemeRaw {
    public readonly isDark: boolean
    public readonly sourceColorArgb: number
    public readonly contrastLevel: ContrastLevel
    public readonly variant: number
    public readonly primaryPaletteArgb: number
    public readonly secondaryPaletteArgb: number
    public readonly tertiaryPaletteArgb: number
    public readonly errorPaletteArgb: number
    public readonly neutralPaletteArgb: number
    public readonly neutralVariantPaletteArgb: number
    public readonly specVersion: SpecVersion
    public readonly isPrimaryPaletteEnabled: boolean
    public readonly isSecondaryPaletteEnabled: boolean
    public readonly isTertiaryPaletteEnabled: boolean
    public readonly isErrorPaletteEnabled: boolean
    public readonly isNeutralPaletteEnabled: boolean
    public readonly isNeutralVariantPaletteEnabled: boolean

    constructor(props: Partial<IThemeRaw> = {}) {
        this.isDark = props.isDark ?? false
        this.sourceColorArgb = props.sourceColorArgb ?? 4278221266
        this.contrastLevel = props.contrastLevel ?? 0
        this.variant = props.variant ?? 2
        this.primaryPaletteArgb = props.primaryPaletteArgb ?? 4283007595
        this.secondaryPaletteArgb = props.secondaryPaletteArgb ?? 4287133460
        this.tertiaryPaletteArgb = props.tertiaryPaletteArgb ?? 4289815094
        this.errorPaletteArgb = props.errorPaletteArgb ?? 4293329021
        this.neutralPaletteArgb = props.neutralPaletteArgb ?? 4284448117
        this.neutralVariantPaletteArgb = props.neutralVariantPaletteArgb ?? 4285364854
        this.specVersion = props.specVersion ?? '2025'
        this.isPrimaryPaletteEnabled = props.isPrimaryPaletteEnabled ?? true
        this.isSecondaryPaletteEnabled = props.isSecondaryPaletteEnabled ?? true
        this.isTertiaryPaletteEnabled = props.isTertiaryPaletteEnabled ?? true
        this.isErrorPaletteEnabled = props.isErrorPaletteEnabled ?? true
        this.isNeutralPaletteEnabled = props.isNeutralPaletteEnabled ?? true
        this.isNeutralVariantPaletteEnabled = props.isNeutralVariantPaletteEnabled ?? true
    }

    static isValid(obj: unknown): obj is IThemeRaw {
        if (typeof obj !== 'object' || obj === null) return false
        const o = obj as Record<string, unknown>
        return (
            typeof o.isDark === 'boolean' &&
            typeof o.sourceColorArgb === 'number' &&
            typeof o.contrastLevel === 'number' &&
            typeof o.variant === 'number' &&
            typeof o.primaryPaletteArgb === 'number' &&
            typeof o.secondaryPaletteArgb === 'number' &&
            typeof o.tertiaryPaletteArgb === 'number' &&
            typeof o.errorPaletteArgb === 'number' &&
            typeof o.neutralPaletteArgb === 'number' &&
            typeof o.neutralVariantPaletteArgb === 'number' &&
            (o.specVersion === '2021' || o.specVersion === '2025') &&
            typeof o.isPrimaryPaletteEnabled === 'boolean' &&
            typeof o.isSecondaryPaletteEnabled === 'boolean' &&
            typeof o.isTertiaryPaletteEnabled === 'boolean' &&
            typeof o.isErrorPaletteEnabled === 'boolean' &&
            typeof o.isNeutralPaletteEnabled === 'boolean' &&
            typeof o.isNeutralVariantPaletteEnabled === 'boolean'
        )
    }

    with(partial: Partial<IThemeRaw>): ThemeEntity {
        return new ThemeEntity({ ...this.toRaw(), ...partial })
    }

    toRaw(): IThemeRaw {
        return { ...this }
    }
}