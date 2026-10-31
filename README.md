# Follow-up UP para WhatsApp Web

Extensão de Chrome/Edge, na identidade visual da UP, que adiciona **agendamento de follow-ups**, **Kanban de leads** e **campanhas** ao WhatsApp Web. Cada pessoa do time usa a própria conta; os dados ficam só no navegador de cada um.

> Ferramenta de **uso interno** da UP Consultoria Imobiliária.

> **Repositório privado:** antes de instalar, cada pessoa precisa do GitHub CLI (https://cli.github.com), de `gh auth login` e de acesso ao repositório (peça ao gestor).

## IA do CRM: Claude Haiku 5.5 (padrão) e Gemini (reserva)

No CRM Incbook o Gemini pode conduzir o registro da atividade (lê a tela e escolhe o próximo clique); a extensão valida cada ação (telefone do lead conferido, comentário definido pelo código, modo teste respeitado, ações perigosas bloqueadas).

- Claude: `ANTHROPIC_API_KEY=...` no `.env.local` (modelo padrão `claude-haiku-5-5`, configurável). Se o Claude falhar, a extensão tenta o Gemini.
- Chave do time embutida no build: crie `.env.local` na raiz (já ignorado pelo git) com `GEMINI_API_KEY=...` antes de `npm run build`/`npm run release`. O ZIP da release é público: restrinja a chave à Generative Language API e defina cota diária baixa no Google.
- Chave individual: Configurações > Piloto Gemini > Chave do Gemini (guardada só no navegador, fora do backup).
- A chave só é lida pelo service worker; as páginas do CRM e do WhatsApp nunca a veem.

## ⚡ Instalação rápida (time)

Não precisa de Node nem de Git. Abra o terminal, cole **um** comando e siga os passos que ele mostrar.

**Mac** (abra o app *Terminal*):

```bash
gh api repos/gabrielupemailinterno-coder/up-followup/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
```

**Windows** (abra o *PowerShell*):

```powershell
gh api repos/gabrielupemailinterno-coder/up-followup/contents/install.ps1 -H "Accept: application/vnd.github.raw" | iex
```

> **Windows:** use o **PowerShell** (ícone azul). No Prompt de Comando (tela preta) o `irm` não existe; lá, use:
> `powershell -NoProfile -ExecutionPolicy Bypass -Command "gh api repos/gabrielupemailinterno-coder/up-followup/contents/install.ps1 -H 'Accept: application/vnd.github.raw' | iex"`

O instalador baixa a versão mais recente, extrai em `~/UP-Followup` (Windows: `C:\Users\SEU_USUARIO\UP-Followup`), copia o caminho para a área de transferência e abre o `chrome://extensions`. Falta só:

1. Ligar o **Modo do desenvolvedor** (canto superior direito).
2. Clicar em **Carregar sem compactação** e escolher a pasta `UP-Followup`.
3. Abrir o [WhatsApp Web](https://web.whatsapp.com) e conectar a conta.

O manual completo abre sozinho na primeira instalação.

### Atualizar

Rode **o mesmo comando** de novo. Depois, em `chrome://extensions`, clique em ↻ na extensão e dê F5 no WhatsApp Web. Seus dados são mantidos.

### Sem terminal

Baixe `up-followup.zip` em [Releases](https://github.com/gabrielupemailinterno-coder/up-followup/releases/latest), extraia em uma pasta fixa e carregue essa pasta em `chrome://extensions` (o manual explica cada passo).

## 📘 Manual

Está dentro da extensão (ícone UP, livro) e em PDF na página de [Releases](https://github.com/gabrielupemailinterno-coder/up-followup/releases/latest). O texto fica em `public/manual/index.html`.

## ✨ O que faz

- **Follow-ups:** agenda por telefone, com templates e variáveis (`{primeiro_nome}`, `{data}`, `{empreendimento}`…), recorrência e **envio automático** (com chave para exigir confirmação). Itens vencidos com o navegador fechado ficam esperando sua decisão.
- **Kanban:** funil de **pré-atendimento** (Novo lead → Tentativa de contato → Em qualificação → Diagnóstico → Visita / Reunião agendada → Follow-up qualificado → Perdido). Todas as colunas são editáveis: nome, descrição, cor, posição e exclusão.
- **Painel do contato** no WhatsApp Web: etapa, tags, notas, follow-ups e tarefas da conversa aberta.
- **Respostas rápidas:** digite `/` no campo de mensagem.
- **Tarefas** e lembretes com notificação.
- **Campanhas:** público do Kanban ou lista colada, no mínimo 5 variações de texto, intervalos aleatórios, limite diário, pausa automática em falhas e barra Pausar/Retomar/Parar.
- **Métricas:** envios por dia, taxa de conclusão, leads por coluna, tempo parado por etapa.
- **CRM Incbook:** lê seus leads, mostra a etapa do lead no WhatsApp, lista leads sem ação e registra a atividade no lead certo depois de cada envio (opera a tela do CRM como uma pessoa; começa em **modo teste**, que preenche mas não envia).
- **Backup** em JSON e CSV.

## 🔌 WA-JS (biblioteca para falar com o WhatsApp Web)

A extensão embute o [WA-JS](https://github.com/wppconnect-team/wa-js) (Apache-2.0), **versão fixada com checksum**, que roda na página do WhatsApp Web. Hoje serve para: descobrir o telefone da conversa aberta e verificar se um número tem WhatsApp. **Se ele não carregar, tudo continua funcionando pelo método antigo.**

- **Privacidade:** o WA-JS vem com Google Analytics ligado e com servidores de terceiros para pré-visualização de links. A extensão desliga tudo isso antes de ele carregar (`public/bridge/wm-wpp-config.js`), e a ponte recusa qualquer chamada se o rastreamento não estiver desligado.
- **Só leitura:** a ponte (`public/bridge/wm-wpp-bridge.js`) aceita uma lista curta de métodos de leitura; não envia mensagens e não devolve nomes nem conteúdo.
- **Checagem:** em Configurações > *Diagnóstico do WhatsApp (WA-JS)* há um teste que mostra se carregou, a versão do WhatsApp e se o rastreamento está desligado.
- **Atualizar o WA-JS (só quem mantém):** `scripts/update-wajs.sh vX.Y.Z` baixa, confere o checksum publicado pelo GitHub e lista os endereços de rede embutidos para revisão. O `npm run build` falha se o arquivo não bater com o checksum de `public/vendor/wa-js/VERSION.json`.
- **Pré-lançamentos:** `npm run release -- --prerelease` não vira a versão padrão do time. Para instalar uma versão específica: `UP_FOLLOWUP_TAG=v1.6.0 bash install.sh` (Mac) ou `$env:UP_FOLLOWUP_TAG="v1.6.0"` antes do comando do PowerShell.

## ⚠️ Avisos importantes

- Os alarmes **só funcionam com o computador ligado e o Chrome aberto**.
- Envio automático e campanhas **violam os termos do WhatsApp** e podem causar bloqueio da conta. As travas reduzem o risco, mas não o eliminam. Veja as boas práticas no manual.
- Os dados **não sincronizam** entre computadores: exporte backups.
- Se o WhatsApp mudar o layout, ajuste só `content/selectors.ts`.

## 🛠️ Desenvolvimento

Requer Node 18+.

```bash
git clone https://github.com/gabrielupemailinterno-coder/up-followup.git
cd up-followup
npm install
npm run dev        # build em modo watch (não injeta o WA-JS; use npm run build para testar no Chrome)
npm run typecheck  # verifica tipos
npm run build      # gera dist/ (carregue esta pasta no Chrome)
npm run pack       # build + releases/whatsapp-web-mod-vX.Y.Z.zip
```

### Publicar uma nova versão

1. Atualize a versão em `package.json`, `manifest.json` e no manual (`public/manual/index.html`).
2. `git commit` e `git push`.
3. `npm run release`: gera `up-followup.zip` e o manual em PDF e cria a release `vX.Y.Z` no GitHub (precisa do [GitHub CLI](https://cli.github.com) logado com `gh auth login`).

O time atualiza rodando o comando de instalação de novo: ele sempre baixa a release mais recente.

### Estrutura

```
├── install.sh / install.ps1       # instaladores por terminal (Mac/Windows)
├── scripts/                       # pack.mjs (zip local) e release.sh (publica no GitHub)
├── background/service-worker.ts   # alarmes, notificações, orquestra os envios
├── content/                       # camada dentro do WhatsApp Web (menu UP, painel, banners…)
│   └── selectors.ts               # TODOS os seletores do DOM do WhatsApp
├── kanban/                        # board, editor de coluna, campanhas, métricas, configurações
├── popup/                         # fila, tarefas e histórico
├── public/
│   ├── manual/                    # manual do time (HTML/CSS/JS estáticos)
│   ├── brand/                     # logos UP extraídos do manual de marca
│   └── fonts/                     # Manrope (licença OFL)
└── src/                           # types, storage, phone, templates, campaign, backup,
                                   # theme (cores/tipografia UP), icons, feedback
```

## Licença

Uso interno. Todos os direitos reservados à UP Consultoria Imobiliária (veja [LICENSE](LICENSE)). A fonte Manrope é distribuída sob a SIL Open Font License.
