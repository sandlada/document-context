// Resolves the git revision TypeDoc pins its "Defined in" links to.
//
// TypeDoc links every "Defined in" reference to the commit it was built from.
// GitHub can only serve that commit once it reaches the remote, so a preview
// of unpushed work would point every reference at a page that does not exist.
// Revisions that already exist on the remote are kept, which is what makes an
// archived version point at the code it shipped with.
import { execFileSync } from 'node:child_process';
import { repositoryRoot } from './site.mjs';

export function resolveSourceRevision() {
    const git = (args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();

    try {
        const revision = git(['rev-parse', 'HEAD']);

        return git(['branch', '--remotes', '--contains', revision]).length > 0 ? revision : 'main';
    } catch {
        return 'main';
    }
}
