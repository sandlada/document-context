import type { IThemeConfig } from "./theme-config";

export interface IThemeChangeDetail extends Partial<IThemeConfig> { }

export interface IThemeInitFromLocalStorageDetail { key?: string }
export interface IThemeSaveChangesDetail { key?: string }

export interface IThemeSetIsDarkDetail { isDark: boolean }
export interface IThemeSetSourceColorArgbDetail { sourceColorArgb: number }
export interface IThemeSetContrastLevelDetail { contrastLevel: number }
export interface IThemeSetVariantDetail { variant: number }
export interface IThemeSetPrimaryPaletteArgbDetail { primaryPaletteArgb: number }
export interface IThemeSetSecondaryPaletteArgbDetail { secondaryPaletteArgb: number }
export interface IThemeSetTertiaryPaletteArgbDetail { tertiaryPaletteArgb: number }
export interface IThemeSetErrorPaletteArgbDetail { errorPaletteArgb: number }
export interface IThemeSetNeutralPaletteArgbDetail { neutralPaletteArgb: number }
export interface IThemeSetNeutralVariantPaletteArgbDetail { neutralVariantPaletteArgb: number }
export interface IThemeSetSpecVersionDetail { specVersion: '2021' | '2025' }

export interface IThemeSetPrimaryPaletteEnabledDetail { isPrimaryPaletteEnabled: boolean }
export interface IThemeSetSecondaryPaletteEnabledDetail { isSecondaryPaletteEnabled: boolean }
export interface IThemeSetTertiaryPaletteEnabledDetail { isTertiaryPaletteEnabled: boolean }
export interface IThemeSetErrorPaletteEnabledDetail { isErrorPaletteEnabled: boolean }
export interface IThemeSetNeutralPaletteEnabledDetail { isNeutralPaletteEnabled: boolean }
export interface IThemeSetNeutralVariantPaletteEnabledDetail { isNeutralVariantPaletteEnabled: boolean }

export interface IAttrSetIsDarkDetail { isDark: boolean }
export interface IAttrSetSpecVersionDetail { specVersion: '2021' | '2025' }
export interface IAttrSetPrimaryPaletteArgbDetail { primaryPaletteArgb: number }
export interface IAttrSetSecondaryPaletteArgbDetail { secondaryPaletteArgb: number }
export interface IAttrSetTertiaryPaletteArgbDetail { tertiaryPaletteArgb: number }
export interface IAttrSetErrorPaletteArgbDetail { errorPaletteArgb: number }
export interface IAttrSetNeutralPaletteArgbDetail { neutralPaletteArgb: number }
export interface IAttrSetNeutralVariantPaletteArgbDetail { neutralVariantPaletteArgb: number }

export interface ICustomEventMap {
    'theme:change-to-light': CustomEvent;
    'theme:change-to-dark': CustomEvent;
    'theme:change': CustomEvent<IThemeChangeDetail>;
    'theme:init-from-local-storage': CustomEvent<IThemeInitFromLocalStorageDetail>;
    'theme:save-changes': CustomEvent<IThemeSaveChangesDetail>;
    'attr:change-to-light': CustomEvent;
    'attr:change-to-dark': CustomEvent;
    'attr:set-is-dark': CustomEvent<IAttrSetIsDarkDetail>;
    'theme:set-is-dark': CustomEvent<IThemeSetIsDarkDetail>;
    'theme:toggle-is-dark': CustomEvent;
    'theme:set-source-color-argb': CustomEvent<IThemeSetSourceColorArgbDetail>;
    'theme:set-contrast-level': CustomEvent<IThemeSetContrastLevelDetail>;
    'theme:set-variant': CustomEvent<IThemeSetVariantDetail>;
    'theme:set-primary-palette-argb': CustomEvent<IThemeSetPrimaryPaletteArgbDetail>;
    'theme:set-secondary-palette-argb': CustomEvent<IThemeSetSecondaryPaletteArgbDetail>;
    'theme:set-tertiary-palette-argb': CustomEvent<IThemeSetTertiaryPaletteArgbDetail>;
    'theme:set-error-palette-argb': CustomEvent<IThemeSetErrorPaletteArgbDetail>;
    'theme:set-neutral-palette-argb': CustomEvent<IThemeSetNeutralPaletteArgbDetail>;
    'theme:set-neutral-variant-palette-argb': CustomEvent<IThemeSetNeutralVariantPaletteArgbDetail>;
    'theme:set-spec-version': CustomEvent<IThemeSetSpecVersionDetail>;
    'theme:toggle-primary-palette': CustomEvent;
    'theme:toggle-secondary-palette': CustomEvent;
    'theme:toggle-tertiary-palette': CustomEvent;
    'theme:toggle-error-palette': CustomEvent;
    'theme:toggle-neutral-palette': CustomEvent;
    'theme:toggle-neutral-variant-palette': CustomEvent;
    'theme:set-primary-palette-enabled': CustomEvent<IThemeSetPrimaryPaletteEnabledDetail>;
    'theme:set-secondary-palette-enabled': CustomEvent<IThemeSetSecondaryPaletteEnabledDetail>;
    'theme:set-tertiary-palette-enabled': CustomEvent<IThemeSetTertiaryPaletteEnabledDetail>;
    'theme:set-error-palette-enabled': CustomEvent<IThemeSetErrorPaletteEnabledDetail>;
    'theme:set-neutral-palette-enabled': CustomEvent<IThemeSetNeutralPaletteEnabledDetail>;
    'theme:set-neutral-variant-palette-enabled': CustomEvent<IThemeSetNeutralVariantPaletteEnabledDetail>;
    'theme:enable-primary-palette': CustomEvent;
    'theme:disable-primary-palette': CustomEvent;
    'theme:enable-secondary-palette': CustomEvent;
    'theme:disable-secondary-palette': CustomEvent;
    'theme:enable-tertiary-palette': CustomEvent;
    'theme:disable-tertiary-palette': CustomEvent;
    'theme:enable-error-palette': CustomEvent;
    'theme:disable-error-palette': CustomEvent;
    'theme:enable-neutral-palette': CustomEvent;
    'theme:disable-neutral-palette': CustomEvent;
    'theme:enable-neutral-variant-palette': CustomEvent;
    'theme:disable-neutral-variant-palette': CustomEvent;
    'attr:set-spec-version': CustomEvent<IAttrSetSpecVersionDetail>;
    'attr:set-primary-palette-argb': CustomEvent<IAttrSetPrimaryPaletteArgbDetail>;
    'attr:set-secondary-palette-argb': CustomEvent<IAttrSetSecondaryPaletteArgbDetail>;
    'attr:set-tertiary-palette-argb': CustomEvent<IAttrSetTertiaryPaletteArgbDetail>;
    'attr:set-error-palette-argb': CustomEvent<IAttrSetErrorPaletteArgbDetail>;
    'attr:set-neutral-palette-argb': CustomEvent<IAttrSetNeutralPaletteArgbDetail>;
    'attr:set-neutral-variant-palette-argb': CustomEvent<IAttrSetNeutralVariantPaletteArgbDetail>;
    'attr:enable-primary-palette': CustomEvent;
    'attr:disable-primary-palette': CustomEvent;
    'attr:enable-secondary-palette': CustomEvent;
    'attr:disable-secondary-palette': CustomEvent;
    'attr:enable-tertiary-palette': CustomEvent;
    'attr:disable-tertiary-palette': CustomEvent;
    'attr:enable-error-palette': CustomEvent;
    'attr:disable-error-palette': CustomEvent;
    'attr:enable-neutral-palette': CustomEvent;
    'attr:disable-neutral-palette': CustomEvent;
    'attr:enable-neutral-variant-palette': CustomEvent;
    'attr:disable-neutral-variant-palette': CustomEvent;
}


