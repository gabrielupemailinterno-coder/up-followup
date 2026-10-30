/* Manual do time: sumário ativo, abas de sistema e botões de copiar. Sem dependências. */
(function () {
  // Versão real quando aberto como página da extensão
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      var v = chrome.runtime.getManifest().version
      document.querySelectorAll('[data-version]').forEach(function (el) { el.textContent = v })
    }
  } catch (e) { /* aberto fora da extensão (PDF/arquivo): mantém a versão estática */ }

  // Sumário: destaca a seção visível
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'))
  var map = {}
  links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a })
  var targets = Object.keys(map).map(function (id) { return document.getElementById(id) }).filter(Boolean)
  if ('IntersectionObserver' in window && targets.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (a) { a.classList.remove('active') })
          var a = map[e.target.id]
          if (a) a.classList.add('active')
        }
      })
    }, { rootMargin: '-20% 0px -70% 0px' })
    targets.forEach(function (t) { io.observe(t) })
  }

  // Abas Windows / Mac
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var buttons = group.querySelectorAll('[role="tab"]')
    var panels = group.parentElement.querySelectorAll('[role="tabpanel"]')
    function select(id) {
      buttons.forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('aria-controls') === id)) })
      panels.forEach(function (p) { p.hidden = p.id !== id })
    }
    buttons.forEach(function (b) { b.addEventListener('click', function () { select(b.getAttribute('aria-controls')) }) })
    var isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
    var first = group.querySelector('[data-os="' + (isMac ? 'mac' : 'win') + '"]') || buttons[0]
    select(first.getAttribute('aria-controls'))
  })

  // Copiar comandos (chrome://extensions não abre por link)
  document.querySelectorAll('.cmd button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.parentElement.querySelector('span').textContent.trim()
      var done = function () { var old = btn.textContent; btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = old }, 1500) }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done)
      else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done() }
    })
  })
})()
