import type { SpecVersion } from "../../domain/entities/theme.entity";
import type { IDOMAttrRepository } from "../../domain/repositories/i-dom-attr.repository";

export class DOMAttrRepository implements IDOMAttrRepository {
    private readonly _doc: Document;

    constructor(doc: Document) {
        this._doc = doc;
    }

    setDark(enabled: boolean): void {
        const el = this._doc.documentElement;
        if (enabled) el.setAttribute("dark", "");
        else el.removeAttribute("dark");
    }

    setSpecVersion(version: SpecVersion): void {
        this._doc.documentElement.setAttribute("spec-version", version);
    }

    setPrimaryPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("primary-palette-argb", String(argb));
    }

    setSecondaryPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("secondary-palette-argb", String(argb));
    }

    setTertiaryPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("tertiary-palette-argb", String(argb));
    }

    setErrorPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("error-palette-argb", String(argb));
    }

    setNeutralPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("neutral-palette-argb", String(argb));
    }

    setNeutralVariantPaletteArgb(argb: number): void {
        this._doc.documentElement.setAttribute("neutral-variant-palette-argb", String(argb));
    }

    enablePrimaryPalette(): void {
        this._doc.documentElement.setAttribute("primary-palette", "");
    }

    disablePrimaryPalette(): void {
        this._doc.documentElement.removeAttribute("primary-palette");
    }

    enableSecondaryPalette(): void {
        this._doc.documentElement.setAttribute("secondary-palette", "");
    }

    disableSecondaryPalette(): void {
        this._doc.documentElement.removeAttribute("secondary-palette");
    }

    enableTertiaryPalette(): void {
        this._doc.documentElement.setAttribute("tertiary-palette", "");
    }

    disableTertiaryPalette(): void {
        this._doc.documentElement.removeAttribute("tertiary-palette");
    }

    enableErrorPalette(): void {
        this._doc.documentElement.setAttribute("error-palette", "");
    }

    disableErrorPalette(): void {
        this._doc.documentElement.removeAttribute("error-palette");
    }

    enableNeutralPalette(): void {
        this._doc.documentElement.setAttribute("neutral-palette", "");
    }

    disableNeutralPalette(): void {
        this._doc.documentElement.removeAttribute("neutral-palette");
    }

    enableNeutralVariantPalette(): void {
        this._doc.documentElement.setAttribute("neutral-variant-palette", "");
    }

    disableNeutralVariantPalette(): void {
        this._doc.documentElement.removeAttribute("neutral-variant-palette");
    }

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
    }): void {
        this.setDark(state.isDark);
        this.setSpecVersion(state.specVersion);
        this.setPrimaryPaletteArgb(state.primaryPaletteArgb);
        this.setSecondaryPaletteArgb(state.secondaryPaletteArgb);
        this.setTertiaryPaletteArgb(state.tertiaryPaletteArgb);
        this.setErrorPaletteArgb(state.errorPaletteArgb);
        this.setNeutralPaletteArgb(state.neutralPaletteArgb);
        this.setNeutralVariantPaletteArgb(state.neutralVariantPaletteArgb);

        if (state.isPrimaryPaletteEnabled) this.enablePrimaryPalette();
        else this.disablePrimaryPalette();

        if (state.isSecondaryPaletteEnabled) this.enableSecondaryPalette();
        else this.disableSecondaryPalette();

        if (state.isTertiaryPaletteEnabled) this.enableTertiaryPalette();
        else this.disableTertiaryPalette();

        if (state.isErrorPaletteEnabled) this.enableErrorPalette();
        else this.disableErrorPalette();

        if (state.isNeutralPaletteEnabled) this.enableNeutralPalette();
        else this.disableNeutralPalette();

        if (state.isNeutralVariantPaletteEnabled) this.enableNeutralVariantPalette();
        else this.disableNeutralVariantPalette();
    }
}