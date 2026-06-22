import type { SpecVersion } from "../entities/theme.entity";

export interface IDOMAttrRepository {
    setDark(enabled: boolean): void;

    setSpecVersion(version: SpecVersion): void;

    setPrimaryPaletteArgb(argb: number): void;

    setSecondaryPaletteArgb(argb: number): void;

    setTertiaryPaletteArgb(argb: number): void;

    setErrorPaletteArgb(argb: number): void;

    setNeutralPaletteArgb(argb: number): void;

    setNeutralVariantPaletteArgb(argb: number): void;

    enablePrimaryPalette(): void;

    disablePrimaryPalette(): void;

    enableSecondaryPalette(): void;

    disableSecondaryPalette(): void;

    enableTertiaryPalette(): void;

    disableTertiaryPalette(): void;

    enableErrorPalette(): void;

    disableErrorPalette(): void;

    enableNeutralPalette(): void;

    disableNeutralPalette(): void;

    enableNeutralVariantPalette(): void;

    disableNeutralVariantPalette(): void;

    syncFromThemeState(state: {
        isDark: boolean;
        specVersion: SpecVersion;
        primaryPaletteArgb: number;
        secondaryPaletteArgb: number;
        tertiaryPaletteArgb: number;
        errorPaletteArgb: number;
        neutralPaletteArgb: number;
        neutralVariantPaletteArgb: number;
        isPrimaryPaletteEnabled: boolean;
        isSecondaryPaletteEnabled: boolean;
        isTertiaryPaletteEnabled: boolean;
        isErrorPaletteEnabled: boolean;
        isNeutralPaletteEnabled: boolean;
        isNeutralVariantPaletteEnabled: boolean;
    }): void;
}