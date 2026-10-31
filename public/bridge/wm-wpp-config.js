/**
 * Roda na página do WhatsApp Web (mundo MAIN), ANTES do WA-JS carregar.
 * O WA-JS lê window.WPPConfig ao iniciar. Aqui desligamos tudo que sai da página para terceiros:
 *  - Google Analytics (ligado por padrão no WA-JS);
 *  - servidores padrão de pré-visualização de link (a lista vazia substitui os padrões).
 */
(function () {
  'use strict'
  window.WPPConfig = Object.assign({}, window.WPPConfig || {}, {
    disableGoogleAnalytics: true,
    googleAnalyticsId: null,
    googleAnalyticsUserProperty: {},
    linkPreviewApiServers: [],
    poweredBy: 'UP-Followup',
  })
})()
