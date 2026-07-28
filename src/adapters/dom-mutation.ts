const observers = new WeakMap<object, MutationObserver>();

export function watchRemoval(target: Node, onRemove: () => void): () => void {
    let parent: ParentNode | null = target.parentNode;
    if (!parent && typeof document !== 'undefined') {
        try { parent = document.body; } catch { parent = null; }
    }
    const obs = new MutationObserver((records) => {
        for (const r of records) {
            if (r.removedNodes.length > 0 && Array.from(r.removedNodes).includes(target)) {
                onRemove();
                obs.disconnect();
                observers.delete(target);
                return;
            }
        }
    });
    if (parent) obs.observe(parent, { childList: true });
    observers.set(target, obs);
    return () => { obs.disconnect(); observers.delete(target); };
}
