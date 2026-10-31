/**
 * Ponte entre a extensão (mundo isolado) e o WA-JS (mundo MAIN da página do WhatsApp Web).
 *
 * Protocolo (window.postMessage):
 *   extensão -> página: { source: 'wm-ext',  id, method, args }
 *   página -> extensão: { source: 'wm-page', id, ok, data | error }
 *
 * Segurança: só responde a mensagens da própria janela, só aceita os métodos da lista abaixo
 * (todos de LEITURA) e recusa tudo se o rastreamento do WA-JS não estiver desligado.
 * Não devolve nomes nem conteúdo de mensagens.
 */
(function () {
  'use strict'
  if (window.__wmWppBridge) return
  window.__wmWppBridge = true

  var QUERY_MIN_GAP_MS = 1200     // no máximo ~1 consulta ao servidor do WhatsApp a cada 1,2 s
  var QUERY_SESSION_CAP = 300     // teto por sessão da página
  var CACHE_TTL_MS = 10 * 60 * 1000

  var queryCache = {}
  var queryCount = 0
  var lastQueryAt = 0

  function W() { return window.WPP }
  function safe(fn, fallback) { try { return fn() } catch (e) { return fallback } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, '') }

  function analyticsOff() {
    var w = W()
    if (!w || !w.config) return false
    if (w.config.disableGoogleAnalytics !== true) {
      safe(function () { w.config.disableGoogleAnalytics = true })   // rede de segurança
    }
    return w.config.disableGoogleAnalytics === true
  }

  var methods = {
    status: function () {
      var w = W()
      return {
        loaded: !!w,
        version: w ? w.version : null,
        waVersion: safe(function () { return window.Debug && window.Debug.VERSION }, null) || null,
        ready: !!(w && w.isReady),
        authenticated: w ? safe(function () { return w.conn.isAuthenticated() }, null) : null,
        mainReady: w ? safe(function () { return w.conn.isMainReady() }, null) : null,
        analyticsDisabled: w ? analyticsOff() : null,
        linkPreviewServers: w && w.config && Array.isArray(w.config.linkPreviewApiServers) ? w.config.linkPreviewApiServers.length : null,
      }
    },

    /** Conversa aberta agora: tipo e telefone (resolve o identificador interno "@lid" para o número). */
    getActiveChat: async function () {
      var w = W()
      var chat = w.chat.getActiveChat()
      if (!chat || !chat.id) return null
      var id = chat.id
      var server = id.server
      var out = { kind: 'other', phone: null }
      if (server === 'g.us') { out.kind = 'group'; return out }
      if (server === 'c.us') { out.kind = 'user'; out.phone = digits(id.user); return out }
      if (server === 'lid') {
        out.kind = 'lid'
        var entry = await w.contact.getPnLidEntry(id._serialized)
        out.phone = entry && entry.phoneNumber ? digits(entry.phoneNumber.id) : null
        return out
      }
      return out
    },

    /** O número tem WhatsApp? Consulta o servidor, então tem cache, intervalo mínimo e teto. */
    queryExists: async function (args) {
      var w = W()
      var phone = digits(args && args.phone)
      if (phone.length < 10 || phone.length > 15) throw new Error('invalid_phone')
      var hit = queryCache[phone]
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
      if (queryCount >= QUERY_SESSION_CAP) throw new Error('query_cap_reached')
      var wait = lastQueryAt + QUERY_MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastQueryAt = Date.now()
      queryCount++
      var res = await w.contact.queryExists(phone + '@c.us')
      var value = { exists: !!res, isBusiness: !!(res && res.biz) }
      queryCache[phone] = { at: Date.now(), value: value }
      return value
    },
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return
    var msg = ev.data
    if (!msg || msg.source !== 'wm-ext' || typeof msg.id === 'undefined') return

    function reply(payload) {
      payload.source = 'wm-page'
      payload.id = msg.id
      window.postMessage(payload, '*')
    }

    var fn = Object.prototype.hasOwnProperty.call(methods, msg.method) ? methods[msg.method] : null
    if (!fn) return reply({ ok: false, error: 'method_not_allowed' })

    if (msg.method !== 'status') {
      if (!W()) return reply({ ok: false, error: 'wpp_not_loaded' })
      if (!W().isReady) return reply({ ok: false, error: 'wpp_not_ready' })
      if (!analyticsOff()) return reply({ ok: false, error: 'analytics_not_disabled' })
    }

    Promise.resolve()
      .then(function () { return fn(msg.args) })
      .then(function (data) { reply({ ok: true, data: data }) })
      .catch(function (e) { reply({ ok: false, error: String((e && e.message) || e) }) })
  })
})()
