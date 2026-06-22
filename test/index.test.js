import { describe, expect, it, beforeEach } from "vitest";
import { enhanceDocument, ContextSymbol } from "../src/index";
import { ThemeEntity } from "../src/domain/entities/theme.entity";
const validThemeConfig = {
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
    specVersion: "2025",
    isPrimaryPaletteEnabled: true,
    isSecondaryPaletteEnabled: true,
    isTertiaryPaletteEnabled: true,
    isErrorPaletteEnabled: true,
    isNeutralPaletteEnabled: true,
    isNeutralVariantPaletteEnabled: true,
};
describe("enhanceDocument", () => {
    beforeEach(() => {
        document.documentElement.removeAttribute("dark");
        document.documentElement.removeAttribute("spec-version");
        document.documentElement.removeAttribute("primary-palette-argb");
        document.documentElement.removeAttribute("secondary-palette-argb");
        document.documentElement.removeAttribute("tertiary-palette-argb");
        document.documentElement.removeAttribute("error-palette-argb");
        document.documentElement.removeAttribute("neutral-palette-argb");
        document.documentElement.removeAttribute("neutral-variant-palette-argb");
        document.documentElement.removeAttribute("primary-palette");
        document.documentElement.removeAttribute("secondary-palette");
        document.documentElement.removeAttribute("tertiary-palette");
        document.documentElement.removeAttribute("error-palette");
        document.documentElement.removeAttribute("neutral-palette");
        document.documentElement.removeAttribute("neutral-variant-palette");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        document[ContextSymbol] = undefined;
    });
    describe("initialization", () => {
        it("should attach ContextSymbol to document", () => {
            enhanceDocument();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(document[ContextSymbol]).toBeDefined();
        });
        it("should set default theme config values", () => {
            enhanceDocument();
            const ctx = document[ContextSymbol];
            const config = ctx.getThemeConfig();
            expect(config.isDark).toBe(false);
            expect(config.sourceColorArgb).toBe(4278221266);
            expect(config.contrastLevel).toBe(0);
            expect(config.variant).toBe(2);
            expect(config.specVersion).toBe("2025");
            expect(config.isPrimaryPaletteEnabled).toBe(true);
        });
        it("should be idempotent — second call does not reinitialize", () => {
            enhanceDocument();
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isDark: true });
            enhanceDocument();
            expect(document[ContextSymbol].getThemeConfig().isDark).toBe(true);
        });
    });
    describe("reactive theme$", () => {
        it("theme$ emits on updateThemeConfig", () => {
            const { bound } = enhanceDocument();
            let latest = bound.getThemeConfig();
            const sub = bound.theme$.subscribe((s) => {
                latest = s;
            });
            bound.updateThemeConfig({ isDark: true });
            expect(latest.isDark).toBe(true);
            sub.unsubscribe();
        });
    });
    describe("theme updates", () => {
        beforeEach(() => {
            enhanceDocument();
        });
        it("updateThemeConfig sets isDark to true", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isDark: true });
            expect(ctx.getThemeConfig().isDark).toBe(true);
        });
        it("updateThemeConfig sets isDark to false", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isDark: true });
            ctx.updateThemeConfig({ isDark: false });
            expect(ctx.getThemeConfig().isDark).toBe(false);
        });
        it("toggleIsDark flips isDark", () => {
            const ctx = document[ContextSymbol];
            const before = ctx.getThemeConfig().isDark;
            ctx.toggleIsDark();
            expect(ctx.getThemeConfig().isDark).toBe(!before);
        });
        it("updateThemeConfig updates individual fields", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ contrastLevel: 1, variant: 3 });
            const c = ctx.getThemeConfig();
            expect(c.contrastLevel).toBe(1);
            expect(c.variant).toBe(3);
        });
        it("updateThemeConfig updates palette enabled flags", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isPrimaryPaletteEnabled: false });
            expect(ctx.getThemeConfig().isPrimaryPaletteEnabled).toBe(false);
            ctx.updateThemeConfig({ isPrimaryPaletteEnabled: true });
            expect(ctx.getThemeConfig().isPrimaryPaletteEnabled).toBe(true);
        });
    });
    describe("isThemeConfig", () => {
        beforeEach(() => {
            enhanceDocument();
        });
        it("returns true for a valid IThemeRaw object", () => {
            const ctx = document[ContextSymbol];
            expect(ctx.isThemeConfig(validThemeConfig)).toBe(true);
        });
        it("returns false for null or primitives", () => {
            const ctx = document[ContextSymbol];
            expect(ctx.isThemeConfig(null)).toBe(false);
            expect(ctx.isThemeConfig(undefined)).toBe(false);
            expect(ctx.isThemeConfig(42)).toBe(false);
            expect(ctx.isThemeConfig("string")).toBe(false);
        });
        it("returns false for an empty object", () => {
            const ctx = document[ContextSymbol];
            expect(ctx.isThemeConfig({})).toBe(false);
        });
        it("returns false when any single required field is missing", () => {
            const ctx = document[ContextSymbol];
            const keys = Object.keys(validThemeConfig);
            for (const key of keys) {
                const partial = { ...validThemeConfig };
                delete partial[key];
                expect(ctx.isThemeConfig(partial)).toBe(false);
            }
        });
        it("returns false when required fields are wrong type", () => {
            const ctx = document[ContextSymbol];
            expect(ctx.isThemeConfig({ ...validThemeConfig, isDark: "yes" })).toBe(false);
            expect(ctx.isThemeConfig({ ...validThemeConfig, sourceColorArgb: "0xff" })).toBe(false);
            expect(ctx.isThemeConfig({ ...validThemeConfig, specVersion: 2025 })).toBe(false);
        });
    });
    describe("localStorage methods", () => {
        beforeEach(() => {
            enhanceDocument();
            localStorage.clear();
        });
        it("saveThemeConfig stores config under default key", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig(validThemeConfig);
            ctx.saveThemeConfig();
            const raw = localStorage.getItem("theme-config");
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw)).toMatchObject(validThemeConfig);
        });
        it("saveThemeConfig stores config under custom key", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig(validThemeConfig);
            ctx.saveThemeConfig("custom-key");
            const raw = localStorage.getItem("custom-key");
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw)).toMatchObject(validThemeConfig);
        });
        it("loadThemeConfig returns stored config", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig(validThemeConfig);
            ctx.saveThemeConfig();
            ctx.updateThemeConfig({ isDark: true });
            ctx.loadThemeConfig();
            expect(ctx.getThemeConfig()).toMatchObject(validThemeConfig);
        });
        it("loadThemeConfig with custom key returns stored config", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig(validThemeConfig);
            ctx.saveThemeConfig("my-key");
            ctx.updateThemeConfig({ isDark: true });
            ctx.loadThemeConfig("my-key");
            expect(ctx.getThemeConfig()).toMatchObject(validThemeConfig);
        });
        it("loadThemeConfig throws when key is missing", () => {
            const ctx = document[ContextSymbol];
            expect(() => ctx.loadThemeConfig("nonexistent-key")).toThrow();
        });
        it("loadThemeConfig throws when stored value is invalid", () => {
            localStorage.setItem("theme-config", JSON.stringify({ foo: "bar" }));
            const ctx = document[ContextSymbol];
            expect(() => ctx.loadThemeConfig()).toThrow("Invalid theme config in local storage");
        });
        it("loadThemeConfig throws when stored value is broken JSON", () => {
            localStorage.setItem("theme-config", "{not valid json");
            const ctx = document[ContextSymbol];
            expect(() => ctx.loadThemeConfig()).toThrow();
        });
    });
    describe("DOM attr sync", () => {
        beforeEach(() => {
            enhanceDocument();
        });
        it('updateThemeConfig({ isDark: true }) adds "dark" attribute', () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isDark: true });
            expect(document.documentElement.hasAttribute("dark")).toBe(true);
        });
        it('updateThemeConfig({ isDark: false }) removes "dark" attribute', () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isDark: true });
            ctx.updateThemeConfig({ isDark: false });
            expect(document.documentElement.hasAttribute("dark")).toBe(false);
        });
        it("updateThemeConfig syncs spec-version attr", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ specVersion: "2021" });
            expect(document.documentElement.getAttribute("spec-version")).toBe("2021");
        });
        it("updateThemeConfig syncs palette argb attrs", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ primaryPaletteArgb: 0x12345678 });
            expect(document.documentElement.getAttribute("primary-palette-argb")).toBe("305419896");
        });
        it("palette enabled updates sync to attr", () => {
            const ctx = document[ContextSymbol];
            ctx.updateThemeConfig({ isPrimaryPaletteEnabled: false });
            expect(document.documentElement.hasAttribute("primary-palette")).toBe(false);
            ctx.updateThemeConfig({ isPrimaryPaletteEnabled: true });
            expect(document.documentElement.hasAttribute("primary-palette")).toBe(true);
        });
        it("syncThemeAttr manually syncs current state", () => {
            const ctx = document[ContextSymbol];
            document.documentElement.removeAttribute("dark");
            ctx.syncThemeAttr();
            const config = ctx.getThemeConfig();
            expect(document.documentElement.hasAttribute("dark")).toBe(config.isDark);
        });
    });
});
//# sourceMappingURL=index.test.js.map