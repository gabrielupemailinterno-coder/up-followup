# Follow-up UP para WhatsApp Web

Extensão de Chrome/Edge, na identidade visual da UP, que adiciona **agendamento de follow-ups**, **Kanban de leads** e **campanhas** ao WhatsApp Web. Cada pessoa do time usa a própria conta; os dados ficam só no navegador de cada um.

> Ferramenta de **uso interno** da UP Consultoria Imobiliária.

## ⚡ Instalação rápida (time)

Não precisa de Node nem de Git. Abra o terminal, cole **um** comando e siga os passos que ele mostrar.

**Mac** (abra o app *Terminal*):

```bash
curl -fsSL https://raw.githubusercontent.com/gabrielupemailinterno-coder/up-followup/main/install.sh | bash
```

**Windows** (abra o *PowerShell*):

```powershell
irm https://raw.githubusercontent.com/gabrielupemailinterno-coder/up-followup/main/install.ps1 | iex
```

> **Windows:** use o **PowerShell** (ícone azul). No Prompt de Comando (tela preta) o `irm` não existe; lá, use:
> `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/gabrielupemailinterno-coder/up-followup/main/install.ps1 | iex"`

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
npm run dev        # build em modo watch
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
