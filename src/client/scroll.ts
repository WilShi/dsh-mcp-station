/**
 * Reference-counted page scroll lock shared by the sidebar drawer and modals.
 * Two overlays can be open at once (drawer + install dialog); unlocking one must
 * not unlock the page under the other.
 */

let locks = 0
let previousOverflow = ''

/**
 * Lock page scrolling until the returned release runs.
 * @returns an idempotent release function.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}
  if (locks === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  locks += 1
  let released = false
  return () => {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0) document.body.style.overflow = previousOverflow
  }
}
