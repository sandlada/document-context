import type { IThemeConfig } from "./theme-config";

export interface IThemeChangeDetail extends Partial<IThemeConfig> { }

export interface IThemeInitFromLocalStorageDetail {
    key?: string
}

export interface IThemeSaveChangesDetail {
    key?: string
}

export interface ICustomEventMap {
    'theme:change-to-light': CustomEvent;
    'theme:change-to-dark': CustomEvent;
    'theme:change': CustomEvent<IThemeChangeDetail>;
    'theme:init-from-local-storage': CustomEvent<IThemeInitFromLocalStorageDetail>;
    'theme:save-changes': CustomEvent<IThemeSaveChangesDetail>;
    'attr:change-to-light': CustomEvent;
    'attr:change-to-dark': CustomEvent;
}


