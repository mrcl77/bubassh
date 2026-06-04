import { el, clear } from '../dom.js'

function defaultPort(proto) {
  return proto === 'sftp' ? 22 : 21
}

function option(value, label, selected) {
  return el('option', { value, selected: value === selected }, label)
}

export function renderConnectBar(state, actions) {
  const bar = document.getElementById('connect-bar')
  clear(bar)

  if (state.connected) {
    const info = state.info || {}
    bar.append(
      el(
        'div',
        { class: 'conn-info' },
        el('span', { class: 'badge badge-ok' }, (info.protocol || '').toUpperCase()),
        el('span', { class: 'conn-target' }, `${info.username ? info.username + '@' : ''}${info.host || ''}`)
      ),
      el(
        'div',
        { class: 'conn-actions' },
        el('button', { class: 'btn', onClick: actions.openSiteManager }, 'Servers'),
        el('button', { class: 'btn btn-danger', onClick: actions.disconnect }, 'Disconnect')
      )
    )
    return
  }

  const f = state.form
  const portInput = el('input', {
    class: 'input input-port',
    placeholder: 'port',
    value: f.port,
    onInput: (e) => (f.port = e.target.value)
  })
  const proto = el(
    'select',
    {
      class: 'input input-proto',
      onChange: (e) => {
        f.protocol = e.target.value
        f.port = defaultPort(f.protocol)
        portInput.value = f.port
      }
    },
    option('sftp', 'SFTP', f.protocol),
    option('ftp', 'FTP', f.protocol),
    option('ftps', 'FTPS', f.protocol)
  )

  const form = el(
    'form',
    {
      class: 'quick-connect',
      onSubmit: (e) => {
        e.preventDefault()
        actions.quickConnect()
      }
    },
    proto,
    el('input', {
      class: 'input input-host',
      placeholder: 'host',
      value: f.host,
      onInput: (e) => (f.host = e.target.value)
    }),
    portInput,
    el('input', {
      class: 'input input-user',
      placeholder: 'username',
      value: f.username,
      onInput: (e) => (f.username = e.target.value)
    }),
    el('input', {
      class: 'input input-pass',
      type: 'password',
      placeholder: 'password',
      value: f.password,
      onInput: (e) => (f.password = e.target.value)
    }),
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Connect'),
    el('button', { class: 'btn', type: 'button', onClick: actions.openSiteManager }, 'Servers')
  )
  bar.append(form)
}
