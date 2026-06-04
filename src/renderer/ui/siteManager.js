import { el, clear, toast } from '../dom.js'
import { confirmModal } from './dialogs.js'

const root = () => document.getElementById('modal-root')
function close() {
  clear(root())
}

function opt(value, label, selected) {
  return el('option', { value, selected: value === selected }, label)
}

function blankProfile() {
  return {
    id: null,
    name: '',
    protocol: 'sftp',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    keyPath: '',
    hasPassword: false,
    hasPassphrase: false
  }
}

export async function openSiteManager(actions) {
  const profiles = await window.api.profiles.list()
  render(profiles, null, actions)
}

function render(profiles, editing, actions) {
  const r = root()
  clear(r)
  const overlay = el('div', { class: 'modal-overlay' })
  const box = el('div', { class: 'modal modal-wide' })

  const list = el('div', { class: 'sm-list' })
  list.append(
    el(
      'div',
      { class: 'sm-list-head' },
      'Saved servers',
      el('div', { class: 'spacer' }),
      el(
        'button',
        { class: 'btn btn-small btn-primary', onClick: () => render(profiles, blankProfile(), actions) },
        '+ New'
      )
    )
  )
  if (!profiles.length) list.append(el('div', { class: 'muted sm-empty' }, 'No saved servers.'))
  for (const p of profiles) {
    list.append(
      el(
        'div',
        { class: 'sm-item' },
        el(
          'div',
          { class: 'sm-item-main', onClick: () => render(profiles, { ...p }, actions) },
          el('div', { class: 'sm-item-name' }, p.name || p.host),
          el(
            'div',
            { class: 'sm-item-sub muted' },
            `${(p.protocol || '').toUpperCase()} · ${p.username ? p.username + '@' : ''}${p.host}:${p.port || ''}`
          )
        ),
        el(
          'button',
          {
            class: 'btn btn-small btn-primary',
            onClick: () => {
              close()
              actions.connectProfile(p.id)
            }
          },
          'Connect'
        ),
        el(
          'button',
          {
            class: 'btn btn-small',
            onClick: async () => {
              const ok = await confirmModal({
                title: 'Delete server',
                message: `Delete "${p.name || p.host}"?`,
                okText: 'Delete'
              })
              if (ok) {
                await window.api.profiles.delete(p.id)
                openSiteManager(actions)
              }
            }
          },
          'Delete'
        )
      )
    )
  }

  const right = editing
    ? renderForm(editing, actions)
    : el('div', { class: 'sm-form sm-form-empty muted' }, 'Select a server from the list or add a new one.')

  box.append(
    el(
      'div',
      { class: 'modal-title' },
      'Servers',
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-small', onClick: close }, 'Close')
    ),
    el('div', { class: 'sm-body' }, list, right)
  )
  overlay.append(box)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  r.append(overlay)
}

function renderForm(p, actions) {
  const fields = {
    id: p.id,
    name: p.name || '',
    protocol: p.protocol || 'sftp',
    host: p.host || '',
    port: p.port || (p.protocol === 'sftp' ? 22 : 21),
    username: p.username || '',
    authType: p.authType || 'password',
    keyPath: p.keyPath || '',
    password: '',
    passphrase: ''
  }

  const field = (key, label, type = 'text', placeholder = '') => {
    const input = el('input', {
      class: 'input',
      type,
      value: fields[key],
      placeholder,
      onInput: (e) => (fields[key] = e.target.value)
    })
    return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input)
  }

  const portInput = el('input', {
    class: 'input',
    type: 'number',
    value: fields.port,
    onInput: (e) => (fields.port = e.target.value)
  })

  const protoSel = el(
    'select',
    {
      class: 'input',
      onChange: (e) => {
        fields.protocol = e.target.value
        if (!p.id) {
          fields.port = fields.protocol === 'sftp' ? 22 : 21
          portInput.value = fields.port
        }
        toggleAuth()
      }
    },
    opt('sftp', 'SFTP', fields.protocol),
    opt('ftp', 'FTP', fields.protocol),
    opt('ftps', 'FTPS', fields.protocol)
  )

  const authSel = el(
    'select',
    {
      class: 'input',
      onChange: (e) => {
        fields.authType = e.target.value
        toggleAuth()
      }
    },
    opt('password', 'Password', fields.authType),
    opt('key', 'Private key', fields.authType)
  )

  const passField = field('password', 'Password', 'password', p.hasPassword ? '•••• (saved — leave blank)' : '')

  const keyPathInput = el('input', {
    class: 'input',
    value: fields.keyPath,
    placeholder: 'path to private key',
    onInput: (e) => (fields.keyPath = e.target.value)
  })
  const keyField = el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label' }, 'Private key'),
    el(
      'div',
      { class: 'row-inline' },
      keyPathInput,
      el(
        'button',
        {
          class: 'btn',
          type: 'button',
          onClick: async () => {
            const f = await window.api.pickKey()
            if (f) {
              keyPathInput.value = f
              fields.keyPath = f
            }
          }
        },
        'Browse…'
      )
    )
  )
  const passphraseField = field(
    'passphrase',
    'Key passphrase (optional)',
    'password',
    p.hasPassphrase ? '•••• (saved — leave blank)' : ''
  )

  const authWrap = el('div', { class: 'auth-wrap' })
  function toggleAuth() {
    clear(authWrap)
    if (fields.protocol === 'sftp') {
      authWrap.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Authentication'), authSel))
      if (fields.authType === 'key') authWrap.append(keyField, passphraseField)
      else authWrap.append(passField)
    } else {
      fields.authType = 'password'
      authWrap.append(passField)
    }
  }
  toggleAuth()

  const save = async () => {
    if (!fields.host) {
      toast('Enter host', 'error')
      return
    }
    const payload = { ...fields, port: Number(fields.port) || (fields.protocol === 'sftp' ? 22 : 21) }
    if (!payload.password) delete payload.password
    if (!payload.passphrase) delete payload.passphrase
    const { id } = await window.api.profiles.save(payload)
    toast('Server saved', 'ok')
    const updated = await window.api.profiles.list()
    render(updated, updated.find((x) => x.id === id) || null, actions)
  }

  return el(
    'div',
    { class: 'sm-form' },
    el('div', { class: 'sm-form-title' }, p.id ? 'Edit server' : 'New server'),
    field('name', 'Name', 'text', 'e.g. My server'),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Protocol'), protoSel),
    el(
      'div',
      { class: 'grid-2' },
      field('host', 'Host', 'text', 'example.com'),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Port'), portInput)
    ),
    field('username', 'Username'),
    authWrap,
    el(
      'div',
      { class: 'modal-actions' },
      el('button', { class: 'btn', onClick: () => openSiteManager(actions) }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onClick: save }, 'Save')
    )
  )
}
