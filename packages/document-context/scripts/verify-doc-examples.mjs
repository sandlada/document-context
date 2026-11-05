import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '../src')

// Use TypeScript compiler from site workspace where TS compiler API is available
const siteRequire = createRequire(path.resolve(__dirname, '../../site/package.json'))
const ts = siteRequire('typescript')

function collectTsFiles(dir) {
    const results = []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            results.push(...collectTsFiles(fullPath))
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('test')) {
            results.push(fullPath)
        }
    }
    return results
}

const files = collectTsFiles(srcDir)
let totalExamples = 0
let failedExamples = 0

console.log(`Scanning ${files.length} source files for @example blocks...`)

for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const relPath = path.relative(srcDir, file).replace(/\\/g, '/')

    // Match JSDoc @example code blocks
    const exampleRegex = /@example\s*\r?\n\s*\*?\s*```(?:ts|typescript)\r?\n([\s\S]*?)```/g
    let match

    while ((match = exampleRegex.exec(content)) !== null) {
        totalExamples += 1
        const rawCode = match[1]
        // Strip leading comment asterisks and whitespace
        const cleanCode = rawCode
            .split('\n')
            .map((line) => line.replace(/^\s*\*\s?/, ''))
            .join('\n')
            .trim()

        if (!cleanCode) {
            console.error(`❌ Empty @example block in ${relPath}`)
            failedExamples += 1
            continue
        }

        // Verify syntax using TypeScript compiler parser
        const sourceFile = ts.createSourceFile(
            'example.ts',
            cleanCode,
            ts.ScriptTarget.ESNext,
            true,
            ts.ScriptKind.TS,
        )

        // Check for syntax diagnostics
        const diagnostics = sourceFile.parseDiagnostics || []
        if (diagnostics.length > 0) {
            console.error(`❌ Syntax error in @example block from ${relPath}:`)
            for (const diag of diagnostics) {
                console.error(`   - ${diag.messageText}`)
            }
            console.error('--- Code Snippet ---')
            console.error(cleanCode)
            console.error('--------------------')
            failedExamples += 1
            continue
        }

        // Verify it's not a trivial 1-line call (must have context/setup/verification)
        const nonCommentLines = cleanCode
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*'))

        if (nonCommentLines.length < 3) {
            console.warn(`⚠️ Warning: @example in ${relPath} seems very short (${nonCommentLines.length} lines)`)
        }
    }
}

console.log(`\nVerified ${totalExamples} @example block(s) across ${files.length} source files.`)

if (failedExamples > 0) {
    console.error(`\n❌ Failed: ${failedExamples} example(s) have errors.`)
    process.exit(1)
} else {
    console.log('✅ All @example blocks parsed successfully with 0 errors!')
}
