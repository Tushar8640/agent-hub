// Copy text. navigator.clipboard only exists on HTTPS/localhost; on a phone over plain http (LAN) the old
// execCommand('copy') way still works, and as a last resort the text is shown so it can be copied by hand.
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try { ok = document.execCommand('copy') } catch { /* ignore */ }
  ta.remove()
  if (!ok) window.prompt('Copy this text:', text)
  return ok
}
