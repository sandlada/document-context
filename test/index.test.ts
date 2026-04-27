import { describe, expect, it } from 'vitest';
import { ContextSymbol, enhanceDocument } from '../src/enhance-document';
import type { IThemeConfig } from '../src/theme-config';

const validThemeConfig: IThemeConfig = {
    isDark: false,
    sourceColorArgb: 0xff4285f4,
    contrastLevel: 0,
    variant: 4,
    primaryPaletteArgb: 0xff4285f4,
    secondaryPaletteArgb: 0xff34a853,
    tertiaryPaletteArgb: 0xfffbbc04,
    errorPaletteArgb: 0xffea4335,
    neutralPaletteArgb: 0xff9aa0a6,
    neutralVariantPaletteArgb: 0xff80868b,
    specVersion: '2025',
};

describe('enhanceDocument', () => {
    describe('initialization', () => {
        it('should attach ContextSymbol to document', () => {
            expect((document as any)[ContextSymbol]).toBeDefined();
        });

        it('should set default themeConfig values', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.themeConfig.isDark).toBe(false);
            expect(ctx.themeConfig.sourceColorArgb).toBe(0);
            expect(ctx.themeConfig.contrastLevel).toBe(0);
            expect(ctx.themeConfig.variant).toBe(4);
            expect(ctx.themeConfig.primaryPaletteArgb).toBe(0);
            expect(ctx.themeConfig.secondaryPaletteArgb).toBe(0);
            expect(ctx.themeConfig.tertiaryPaletteArgb).toBe(0);
            expect(ctx.themeConfig.errorPaletteArgb).toBe(0);
            expect(ctx.themeConfig.neutralPaletteArgb).toBe(0);
            expect(ctx.themeConfig.neutralVariantPaletteArgb).toBe(0);
            expect(ctx.themeConfig.specVersion).toBe('2025');
        });

        it('should be idempotent — second call does not reinitialize', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeConfig.isDark = true;
            enhanceDocument();
            expect((document as any)[ContextSymbol].themeConfig.isDark).toBe(true);
        });
    });

    describe('getters and setters', () => {
        it('getIsDark / setIsDark', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setIsDark(true);
            expect(ctx.getIsDark()).toBe(true);
            ctx.setIsDark(false);
            expect(ctx.getIsDark()).toBe(false);
        });

        it('getSourceColorArgb / setSourceColorArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setSourceColorArgb(0xff1234ab);
            expect(ctx.getSourceColorArgb()).toBe(0xff1234ab);
        });

        it('getContrastLevel / setContrastLevel', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setContrastLevel(1);
            expect(ctx.getContrastLevel()).toBe(1);
        });

        it('getVariant / setVariant', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setVariant(2);
            expect(ctx.getVariant()).toBe(2);
        });

        it('getPrimaryPaletteArgb / setPrimaryPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setPrimaryPaletteArgb(0xffaabbcc);
            expect(ctx.getPrimaryPaletteArgb()).toBe(0xffaabbcc);
        });

        it('getSecondaryPaletteArgb / setSecondaryPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setSecondaryPaletteArgb(0xffbbccdd);
            expect(ctx.getSecondaryPaletteArgb()).toBe(0xffbbccdd);
        });

        it('getTertiaryPaletteArgb / setTertiaryPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setTertiaryPaletteArgb(0xffccddee);
            expect(ctx.getTertiaryPaletteArgb()).toBe(0xffccddee);
        });

        it('getErrorPaletteArgb / setErrorPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setErrorPaletteArgb(0xffea4335);
            expect(ctx.getErrorPaletteArgb()).toBe(0xffea4335);
        });

        it('getNeutralPaletteArgb / setNeutralPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setNeutralPaletteArgb(0xff9aa0a6);
            expect(ctx.getNeutralPaletteArgb()).toBe(0xff9aa0a6);
        });

        it('getNeutralVariantPaletteArgb / setNeutralVariantPaletteArgb', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setNeutralVariantPaletteArgb(0xff80868b);
            expect(ctx.getNeutralVariantPaletteArgb()).toBe(0xff80868b);
        });

        it('getSpecVersion / setSpecVersion', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.setSpecVersion('2021');
            expect(ctx.getSpecVersion()).toBe('2021');
            ctx.setSpecVersion('2025');
            expect(ctx.getSpecVersion()).toBe('2025');
        });
    });

    describe('isThemeConfig', () => {
        it('returns true for a valid IThemeConfig object', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.isThemeConfig(validThemeConfig)).toBe(true);
        });

        it('returns false for null or primitives', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.isThemeConfig(null)).toBe(false);
            expect(ctx.isThemeConfig(undefined)).toBe(false);
            expect(ctx.isThemeConfig(42)).toBe(false);
            expect(ctx.isThemeConfig('string')).toBe(false);
        });

        it('returns false for an empty object', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.isThemeConfig({})).toBe(false);
        });

        it('returns false when any single required field is missing', () => {
            const ctx = (document as any)[ContextSymbol];
            const keys = Object.keys(validThemeConfig) as (keyof typeof validThemeConfig)[];
            for (const key of keys) {
                const partial = { ...validThemeConfig };
                delete (partial as any)[key];
                expect(ctx.isThemeConfig(partial)).toBe(false);
            }
        });

        it('returns false when required fields are wrong type', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.isThemeConfig({ ...validThemeConfig, isDark: 'yes' })).toBe(false);
            expect(ctx.isThemeConfig({ ...validThemeConfig, sourceColorArgb: '0xff' })).toBe(false);
            expect(ctx.isThemeConfig({ ...validThemeConfig, specVersion: 2025 })).toBe(false);
        });
    });

    describe('themeChangeToLight / themeChangeToDark', () => {
        it('themeChangeToDark sets isDark to true', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeChangeToDark();
            expect(ctx.themeConfig.isDark).toBe(true);
        });

        it('themeChangeToLight sets isDark to false', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeChangeToDark();
            ctx.themeChangeToLight();
            expect(ctx.themeConfig.isDark).toBe(false);
        });
    });

    describe('attrChangeToLight / attrChangeToDark', () => {
        it('attrChangeToDark adds "dark" attribute to documentElement', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.attrChangeToDark();
            expect(document.documentElement.hasAttribute('dark')).toBe(true);
        });

        it('attrChangeToDark is idempotent when attribute already set', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.attrChangeToDark();
            ctx.attrChangeToDark();
            expect(document.documentElement.getAttribute('dark')).toBe('');
        });

        it('attrChangeToLight removes "dark" attribute from documentElement', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.attrChangeToDark();
            ctx.attrChangeToLight();
            expect(document.documentElement.hasAttribute('dark')).toBe(false);
        });

        it('attrChangeToLight is a no-op when attribute is not set', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(() => ctx.attrChangeToLight()).not.toThrow();
            expect(document.documentElement.hasAttribute('dark')).toBe(false);
        });
    });

    describe('localStorage methods', () => {
        it('saveThemeConfigToLocalStorage stores config under default key', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.saveThemeConfigToLocalStorage(validThemeConfig);
            const raw = localStorage.getItem('theme-config');
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw!)).toMatchObject(validThemeConfig);
        });

        it('saveThemeConfigToLocalStorage stores config under custom key', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.saveThemeConfigToLocalStorage(validThemeConfig, 'custom-key');
            const raw = localStorage.getItem('custom-key');
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw!)).toMatchObject(validThemeConfig);
        });

        it('getThemeConfigFromLocalStorage returns stored config', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.saveThemeConfigToLocalStorage(validThemeConfig);
            const result = ctx.getThemeConfigFromLocalStorage();
            expect(result).toMatchObject(validThemeConfig);
        });

        it('getThemeConfigFromLocalStorage with custom key returns stored config', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.saveThemeConfigToLocalStorage(validThemeConfig, 'my-key');
            const result = ctx.getThemeConfigFromLocalStorage('my-key');
            expect(result).toMatchObject(validThemeConfig);
        });

        it('getThemeConfigFromLocalStorage throws when key is missing', () => {
            const ctx = (document as any)[ContextSymbol];
            expect(() => ctx.getThemeConfigFromLocalStorage('nonexistent-key')).toThrow();
        });

        it('getThemeConfigFromLocalStorage throws when stored value is invalid', () => {
            localStorage.setItem('theme-config', JSON.stringify({ foo: 'bar' }));
            const ctx = (document as any)[ContextSymbol];
            expect(() => ctx.getThemeConfigFromLocalStorage()).toThrow('Invalid theme config in local storage');
        });

        it('getThemeConfigFromLocalStorage throws when stored value is broken JSON', () => {
            localStorage.setItem('theme-config', '{not valid json');
            const ctx = (document as any)[ContextSymbol];
            expect(() => ctx.getThemeConfigFromLocalStorage()).toThrow();
        });
    });

    describe('custom events', () => {
        it('theme:change-to-dark sets isDark to true', () => {
            const ctx = (document as any)[ContextSymbol];
            document.dispatchEvent(new CustomEvent('theme:change-to-dark'));
            expect(ctx.themeConfig.isDark).toBe(true);
        });

        it('theme:change-to-light sets isDark to false', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeConfig.isDark = true;
            document.dispatchEvent(new CustomEvent('theme:change-to-light'));
            expect(ctx.themeConfig.isDark).toBe(false);
        });

        it('theme:change updates individual fields via event detail', () => {
            const ctx = (document as any)[ContextSymbol];
            document.dispatchEvent(new CustomEvent('theme:change', { detail: { isDark: true, contrastLevel: 1, specVersion: '2021' } }));
            expect(ctx.themeConfig.isDark).toBe(true);
            expect(ctx.themeConfig.contrastLevel).toBe(1);
            expect(ctx.themeConfig.specVersion).toBe('2021');
        });

        it('theme:change ignores undefined fields', () => {
            const ctx = (document as any)[ContextSymbol];
            const original = ctx.themeConfig.sourceColorArgb;
            document.dispatchEvent(new CustomEvent('theme:change', { detail: { isDark: true } }));
            expect(ctx.themeConfig.sourceColorArgb).toBe(original);
        });

        it('theme:change with null field value skips that field', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeConfig.isDark = false;
            document.dispatchEvent(new CustomEvent('theme:change', { detail: { isDark: null } }));
            expect(ctx.themeConfig.isDark).toBe(false);
        });

        it('theme:change with no detail (null) does not throw', () => {
            expect(() => {
                document.dispatchEvent(new CustomEvent('theme:change'));
            }).not.toThrow();
        });

        it('attr:change-to-dark adds "dark" attribute', () => {
            document.dispatchEvent(new CustomEvent('attr:change-to-dark'));
            expect(document.documentElement.hasAttribute('dark')).toBe(true);
        });

        it('attr:change-to-light removes "dark" attribute', () => {
            document.documentElement.setAttribute('dark', '');
            document.dispatchEvent(new CustomEvent('attr:change-to-light'));
            expect(document.documentElement.hasAttribute('dark')).toBe(false);
        });

        it('theme:init-from-local-storage loads themeConfig from default key', () => {
            localStorage.setItem('theme-config', JSON.stringify(validThemeConfig));
            document.dispatchEvent(new CustomEvent('theme:init-from-local-storage', { detail: {} }));
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.themeConfig).toMatchObject(validThemeConfig);
        });

        it('theme:init-from-local-storage loads themeConfig from custom key', () => {
            localStorage.setItem('my-theme', JSON.stringify(validThemeConfig));
            document.dispatchEvent(new CustomEvent('theme:init-from-local-storage', { detail: { key: 'my-theme' } }));
            const ctx = (document as any)[ContextSymbol];
            expect(ctx.themeConfig).toMatchObject(validThemeConfig);
        });

        it('theme:init-from-local-storage throws when key does not exist in storage', () => {
            expect(() => {
                document.dispatchEvent(new CustomEvent('theme:init-from-local-storage', { detail: { key: 'missing-key' } }));
            }).toThrow();
        });

        it('theme:save-changes persists current themeConfig to default key', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeConfig = { ...validThemeConfig, isDark: true };
            document.dispatchEvent(new CustomEvent('theme:save-changes', { detail: {} }));
            const raw = localStorage.getItem('theme-config');
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw!).isDark).toBe(true);
        });

        it('theme:save-changes persists current themeConfig to custom key', () => {
            const ctx = (document as any)[ContextSymbol];
            ctx.themeConfig = { ...validThemeConfig };
            document.dispatchEvent(new CustomEvent('theme:save-changes', { detail: { key: 'saved-theme' } }));
            const raw = localStorage.getItem('saved-theme');
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw!)).toMatchObject(validThemeConfig);
        });
    });
});
