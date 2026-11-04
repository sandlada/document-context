// Replaces TypeDoc's per-overload signature tables with a single TS code block.
//
// `typedoc-plugin-markdown` renders every overload as its own `Call Signature`
// section with repeated Defined in / Type Parameters / Parameters / Returns
// blocks. For a curried operator that is two near-identical tables; for `pipe`
// it is eleven. The overload declarations in `src/` already state the same
// types more compactly, in the syntax readers know from IDE hovers and `.d.ts`
// files, so each `### fn()` section keeps one fenced `ts` block built from the
// source declarations and drops the generated tables. Sections read top to
// bottom as description, signature block plus file-level source link, then
// examples and notes. Descriptions, examples and `Throws` notes are preserved;
// non-function sections (interfaces, type aliases, const objects) are untouched.
//
// Runs in `config:setup` after `starlight-typedoc` regenerates
// `src/content/docs/api/`. Archived versions under a `versions.json` slug keep
// their frozen copies and are never touched.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { writeFileIfChanged } from '../lib/io.mjs';
import { modules, repositoryRoot, siteRoot } from '../lib/site.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const apiDirectory = join(siteRoot, 'src/content/docs/api');
const srcDirectory = join(repositoryRoot, 'src');

const FUNCTION_HEADING = /^### (\w+)\(\)\s*$/;
const SECTION_BOUNDARY = /^#{1,3} /;
const CALL_SIGNATURE = /^#### Call Signature\s*$/;
const DETAIL_SECTION = /^#{4,5} (Type Parameters|Parameters|Returns)\s*$/;
const SIGNATURE_QUOTE = /^> \*\*\w+\*\*/;
const DEFINED_IN = /^Defined in: \[([^\]]+)\]\(([^)]+)\)\s*$/;
const FENCE = /^```/;
const HEADING_OR_FENCE_OR_RULE = /^(#{1,6} |```|\*\*\*)/;

function hasExportModifier(node) {
    return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Indexes every exported function declaration in `src/<module>/*.ts` by
 * `module/name`. Overloads win over the implementation signature; `const`
 * arrow functions are recorded in `d.ts` style (`export const f: () => T;`).
 */
function collectDeclarations() {
    const collected = new Map();

    for (const module of modules) {
        let files;

        try {
            files = readdirSync(join(srcDirectory, module));
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.ts') || file.endsWith('.d.ts')) {
                continue;
            }

            if (file === 'index.ts' || file.includes('.spec.') || file.includes('.bench.')) {
                continue;
            }

            const content = readFileSync(join(srcDirectory, module, file), 'utf8');
            const source = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true);
            const overloads = new Map();
            const fallback = new Map();

            for (const statement of source.statements) {
                if (
                    ts.isFunctionDeclaration(statement) &&
                    statement.name !== undefined &&
                    hasExportModifier(statement)
                ) {
                    const name = statement.name.text;

                    if (statement.body === undefined) {
                        const list = overloads.get(name) ?? [];
                        list.push(statement.getText(source));
                        overloads.set(name, list);
                    } else if (!fallback.has(name)) {
                        const signature = content
                            .slice(statement.getStart(source), statement.body.getStart(source))
                            .trim();
                        fallback.set(name, `${signature};`);
                    }
                } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
                    const [declaration] = statement.declarationList.declarations;

                    if (
                        declaration !== undefined &&
                        statement.declarationList.declarations.length === 1 &&
                        ts.isIdentifier(declaration.name) &&
                        declaration.initializer !== undefined &&
                        ts.isArrowFunction(declaration.initializer)
                    ) {
                        const arrow = declaration.initializer;
                        const typeParameters =
                            arrow.typeParameters !== undefined && arrow.typeParameters.length > 0
                                ? `<${arrow.typeParameters.map((parameter) => parameter.getText(source)).join(', ')}>`
                                : '';
                        const parameters = arrow.parameters
                            .map((parameter) => parameter.getText(source))
                            .join(', ');
                        const returns = arrow.type !== undefined ? arrow.type.getText(source) : 'unknown';
                        fallback.set(
                            declaration.name.text,
                            `export const ${declaration.name.text}: ${typeParameters}(${parameters}) => ${returns};`,
                        );
                    }
                }
            }

            for (const [name, declarations] of overloads) {
                collected.set(`${module}/${name}`, declarations);
            }

            for (const [name, signature] of fallback) {
                if (!overloads.has(name)) {
                    collected.set(`${module}/${name}`, [signature]);
                }
            }
        }
    }

    return collected;
}

function mergeDefinedIn(entries) {
    const file = entries[0].text.match(/^(.*):\d+$/)?.[1] ?? entries[0].text;
    const base = entries[0].url.split('#')[0];

    return `Defined in: [${file}](${base})`;
}

/**
 * True when a section still carries TypeDoc's generated signature blocks. A
 * section the transform already processed has none left, so returning it
 * untouched keeps repeated runs (dev-server reloads, manual re-runs) stable.
 */
function hasTypeDocMarkers(section) {
    let inFence = false;

    for (const line of section) {
        if (FENCE.test(line)) {
            inFence = !inFence;
            continue;
        }

        if (
            !inFence &&
            (CALL_SIGNATURE.test(line) || SIGNATURE_QUOTE.test(line) || DETAIL_SECTION.test(line))
        ) {
            return true;
        }
    }

    return false;
}

function transformSection(module, name, section, declarations) {
    if (!hasTypeDocMarkers(section)) {
        return section;
    }

    const overloads = declarations.get(`${module}/${name}`);

    if (overloads === undefined) {
        throw new Error(
            `Generated API section '${name}()' in site/src/content/docs/api/${module}.md ` +
                'has no exported declaration in src/. Add one or extend site/plugins/overload-codeblocks.mjs.',
        );
    }

    const definedIns = [];
    const kept = [];
    let inFence = false;
    let index = 1;

    while (index < section.length) {
        const line = section[index];

        if (FENCE.test(line)) {
            inFence = !inFence;
            kept.push(line);
            index += 1;
            continue;
        }

        if (!inFence) {
            if (CALL_SIGNATURE.test(line) || SIGNATURE_QUOTE.test(line)) {
                index += 1;
                continue;
            }

            const definedIn = line.match(DEFINED_IN);

            if (definedIn) {
                definedIns.push({ text: definedIn[1], url: definedIn[2] });
                index += 1;
                continue;
            }

            if (DETAIL_SECTION.test(line)) {
                index += 1;

                while (index < section.length && !HEADING_OR_FENCE_OR_RULE.test(section[index])) {
                    index += 1;
                }

                continue;
            }
        }

        kept.push(line);
        index += 1;
    }

    while (kept.length > 0 && kept[0].trim() === '') {
        kept.shift();
    }

    while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
        kept.pop();
    }

    // Removing quote/Defined in/table lines orphans their surrounding blank
    // lines (about three per overload). Collapse blank runs outside fenced
    // code so every gap is exactly one line; fence interiors are preserved.
    const collapsed = [];
    inFence = false;

    for (const line of kept) {
        if (FENCE.test(line)) {
            inFence = !inFence;
        }

        if (!inFence && line.trim() === '' && collapsed[collapsed.length - 1]?.trim() === '') {
            continue;
        }

        collapsed.push(line);
    }

    const rebuilt = [section[0]];
    let split = collapsed.length;
    let fenced = false;

    for (let i = 0; i < collapsed.length; i++) {
        if (FENCE.test(collapsed[i])) {
            fenced = !fenced;
            continue;
        }

        if (!fenced && /^#{4,6} /.test(collapsed[i])) {
            split = i;
            break;
        }
    }

    const description = collapsed.slice(0, split);

    while (description.length > 0 && description[description.length - 1].trim() === '') {
        description.pop();
    }

    const rest = collapsed.slice(split);

    if (description.length > 0) {
        rebuilt.push('', ...description);
    }

    rebuilt.push('', '```ts', ...overloads, '```');

    if (definedIns.length > 0) {
        rebuilt.push('', mergeDefinedIn(definedIns));
    }

    if (rest.length > 0) {
        rebuilt.push('', ...rest);
    }

    return rebuilt;
}

function transformPage(module, markdown, declarations) {
    const frontmatter = markdown.match(/^---\n[\s\S]*?\n---\n/);
    const prefix = frontmatter ? frontmatter[0] : '';
    const lines = (frontmatter ? markdown.slice(prefix.length) : markdown).split('\n');
    const output = [];
    let functions = 0;
    let index = 0;
    let inFence = false;

    while (index < lines.length) {
        const line = lines[index];

        if (FENCE.test(line)) {
            inFence = !inFence;
        }

        const heading = inFence ? null : line.match(FUNCTION_HEADING);

        if (heading === null) {
            output.push(line);
            index += 1;
            continue;
        }

        let end = index + 1;
        let fenced = false;

        while (end < lines.length) {
            if (FENCE.test(lines[end])) {
                fenced = !fenced;
            }

            if (!fenced && SECTION_BOUNDARY.test(lines[end])) {
                break;
            }

            end += 1;
        }

        output.push(...transformSection(module, heading[1], lines.slice(index, end), declarations));
        functions += 1;
        index = end;
    }

    return { markdown: prefix + output.join('\n'), functions };
}

const overloadCodeblocks = {
    name: 'overload-codeblocks',
    hooks: {
        'config:setup'({ logger }) {
            const declarations = collectDeclarations();
            const pages = readdirSync(apiDirectory)
                .filter((file) => file.endsWith('.md'))
                .sort();
            let functions = 0;
            let updated = 0;

            for (const file of pages) {
                const module = file.slice(0, -'.md'.length);
                const path = join(apiDirectory, file);
                const before = readFileSync(path, 'utf8');
                const { markdown: after, functions: count } = transformPage(module, before, declarations);
                functions += count;

                if (after !== before && writeFileIfChanged(path, after) !== 'unchanged') {
                    updated += 1;
                }
            }

            logger.info(
                `Replaced signature tables with code blocks in ${functions} functions across ${updated} API pages.`,
            );
        },
    },
};

export default overloadCodeblocks;
