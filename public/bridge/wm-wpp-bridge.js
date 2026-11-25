/**
 * Ponte entre a extensão (mundo isolado) e o WA-JS (mundo MAIN da página do WhatsApp Web).
 *
 * Protocolo (window.postMessage):
 *   extensão -> página: { source: 'wm-ext',  id, method, args }
 *   página -> extensão: { source: 'wm-page', id, ok, data | error }
 *
 * Segurança: só responde a mensagens da própria janela, só aceita os métodos da lista abaixo
 * e recusa tudo se o rastreamento do WA-JS não estiver desligado. Todos são de LEITURA, menos
 * sendImage e sendLink, que só enviam para a conversa aberta e se o telefone conferir.
 * Nunca devolve conteúdo de mensagens. Nomes só saem em getGroupParticipants, quando o usuário
 * pede para salvar os membros do grupo aberto no Kanban.
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
  var SEND_MIN_GAP_MS = 5000      // trava contra envios em rajada
  var lastSendAt = {}

  function W() { return window.WPP }
  function safe(fn, fallback) { try { return fn() } catch (e) { return fallback } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, '') }
  // No Brasil o WhatsApp às vezes omite o nono dígito: compara sem ele.
  function phoneKey(s) { return digits(s).replace(/^55(\d{2})9?(\d{8})$/, '55$1$2') }

  function analyticsOff() {
    var w = W()
    if (!w || !w.config) return false
    if (w.config.disableGoogleAnalytics !== true) {
      safe(function () { w.config.disableGoogleAnalytics = true })   // rede de segurança
    }
    return w.config.disableGoogleAnalytics === true
  }

  /** Id da conversa aberta, só se for a do telefone pedido; trava envios em rajada. */
  async function chatFor(method, args) {
    var active = await methods.getActiveChat()
    if (!active || !active.phone || phoneKey(active.phone) !== phoneKey(args && args.phone)) throw new Error('wrong_chat')
    var chat = W().chat.getActiveChat()
    if (Date.now() - (lastSendAt[method] || 0) < SEND_MIN_GAP_MS) throw new Error('send_too_fast')
    lastSendAt[method] = Date.now()
    return chat.id._serialized
  }

  function confirmSent(res) {
    var result = res && res.sendMsgResult
    var code = String((result && result.messageSendResult) || result || '')
    if (!(res && res.ack >= 1) && code !== 'OK') throw new Error('send_failed ' + code)
    return { sent: true }
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

    /** Membros do grupo aberto (nome e telefone). Só lê o que o WhatsApp Web já tem. */
    getGroupParticipants: async function () {
      var w = W()
      var chat = w.chat.getActiveChat()
      if (!chat || !chat.id || chat.id.server !== 'g.us') throw new Error('not_group')
      var list = await w.group.getParticipants(chat.id._serialized)
      var me = digits(safe(function () { return w.conn.getMyUserId().user }, ''))
      var out = { groupName: String(chat.formattedTitle || chat.name || safe(function () { return chat.groupMetadata.subject }, '') || 'Grupo'), members: [], hidden: 0 }

      function nameOf(c) { return c ? (safe(function () { return c.name || c.pushname || c.verifiedName }, '') || '') : '' }

      for (var i = 0; i < list.length; i++) {
        var p = list[i]
        var id = p && p.id
        if (!id) continue
        if (safe(function () { return p.contact.isMe }, false)) continue
        var phone = ''
        var entry = null
        if (id.server === 'c.us') phone = digits(id.user)
        else if (id.server === 'lid') {
          try { entry = await w.contact.getPnLidEntry(id._serialized) } catch (e) { entry = null }
          phone = entry && entry.phoneNumber ? digits(entry.phoneNumber.id) : ''
        }
        if (!phone) { out.hidden++; continue }
        if (phone === me) continue
        var saved = null
        try { saved = await w.contact.get(phone + '@c.us') } catch (e) { saved = null }
        var name = nameOf(saved) || nameOf(safe(function () { return p.contact }, null)) || nameOf(entry && entry.contact)
        out.members.push({ phone: phone, name: String(name) })
      }
      return out
    },

    /** Envia uma imagem com legenda para a conversa aberta, desde que seja a do telefone pedido. */
    sendImage: async function (args) {
      var dataUrl = String((args && args.dataUrl) || '')
      if (!/^data:image\/(jpeg|png);base64,/.test(dataUrl)) throw new Error('invalid_image')
      var chatId = await chatFor('sendImage', args)
      return confirmSent(await W().chat.sendFileMessage(chatId, dataUrl, {
        type: 'image', caption: String(args.caption || ''), filename: 'imagem.jpg', waitForAck: true,
      }))
    },

    /** Segunda mensagem com um link: como botão ou com o cartão de prévia do próprio WhatsApp. */
    sendLink: async function (args) {
      var url = String((args && args.url) || '')
      var text = String((args && args.text) || '')
      var label = String((args && args.label) || '')
      var button = !!args && args.style === 'button'
      if (!/^https?:\/\/\S+$/i.test(url) || !text || (button && !label)) throw new Error('invalid_link')
      var chatId = await chatFor('sendLink', args)
      return confirmSent(await W().chat.sendTextMessage(
        chatId,
        button ? text : text + '\n' + url,
        button
          ? { buttons: [{ url: url, text: label }], linkPreview: false, waitForAck: true }
          : { linkPreview: true, waitForAck: true }
      ))
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
