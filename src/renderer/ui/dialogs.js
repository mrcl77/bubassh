import { el, clear } from '../dom.js'

const root = () => document.getElementById('modal-root')

export function closeModal() {
  clear(root())
}

function openModal(content) {
  const r = root()
  clear(r)
  const overlay = el('div', { class: 'modal-overlay' }, el('div', { class: 'modal' }, content))
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeModal()
  })
  r.append(overlay)
  return overlay
}

export function promptModal({ title, label, value = '', okText = 'OK', placeholder = '' }) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', value, placeholder })
    const submit = () => {
      const v = input.value.trim()
      closeModal()
      resolve(v)
    }
    const cancel = () => {
      closeModal()
      resolve(null)
    }
    openModal(
      el(
        'div',
        {},
        el('h2', { class: 'modal-title' }, title),
        label ? el('label', { class: 'modal-label' }, label) : null,
        input,
        el(
          'div',
          { class: 'modal-actions' },
          el('button', { class: 'btn', onClick: cancel }, 'Cancel'),
          el('button', { class: 'btn btn-primary', onClick: submit }, okText)
        )
      )
    )
    input.focus()
    input.select()
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
      else if (e.key === 'Escape') cancel()
    })
  })
}

export function confirmModal({ title, message, okText = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    openModal(
      el(
        'div',
        {},
        el('h2', { class: 'modal-title' }, title),
        el('p', { class: 'modal-text' }, message),
        el(
          'div',
          { class: 'modal-actions' },
          el('button', { class: 'btn', onClick: () => { closeModal(); resolve(false) } }, 'Cancel'),
          el(
            'button',
            {
              class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
              onClick: () => { closeModal(); resolve(true) }
            },
            okText
          )
        )
      )
    )
  })
}
