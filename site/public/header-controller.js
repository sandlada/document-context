// @ts-check
/// <reference lib="dom" />

/**
 * @param {HTMLElement} header
 */
function collapseHeader(header) {
    header.classList.add(`collapsed`)
}
/**
 * @param {HTMLElement} header
 */
function expandHeader(header) {
    header.classList.remove(`collapsed`)
}

window.addEventListener('DOMContentLoaded', () => {
    const anchor = document.querySelector(`h1#_top`)
    const header = document.querySelector('header');

    if(!anchor) return
    if (!header) return

    const m = new IntersectionObserver((entries) => {
        const latest = entries[entries.length - 1]

        if(latest.isIntersecting) expandHeader(header)
        else collapseHeader(header)
    })

    m.observe(anchor)
});
