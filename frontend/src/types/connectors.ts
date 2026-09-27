export interface SetupStep {
  label: string;
  url?: string;
  urlLabel?: string;
}

export interface ConnectorMeta {
  connector_id: string;
  display_name: string;
  auth_type: 'oauth' | 'local' | 'bridge' | 'filesystem' | 'token';
  category: 'communication' | 'documents' | 'pim' | 'other';
  icon: string;
  color: string;
  description: string;
  unitLabel?: string;  // "emails", "messages", "meeting notes", "pages", "notes", etc.
  steps?: SetupStep[];
  troubleshooting?: string[];
  inputFields?: Array<{
    name: string;
    placeholder: string;
    type?: 'text' | 'password' | 'number' | 'select';
    required?: boolean;
    defaultValue?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
}

export interface OAuthSetupInfo {
  provider: string;
  setup_url: string;
  setup_hint: string;
  has_credentials: boolean;
}

export interface ConnectorInfo {
  connector_id: string;
  display_name: string;
  auth_type: "oauth" | "local" | "bridge" | "filesystem" | "token";
  connected: boolean;
  auth_url?: string;
  mcp_tools?: string[];
  chunks?: number;
  oauth_setup?: OAuthSetupInfo | null;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "stopping" | "paused" | "error";
  items_synced: number;
  items_total: number;
  /** Items processed in the current (or most recent) run only. `null`
   *  when no sync has been triggered through this server session yet. */
  new_items_synced?: number | null;
  /** ISO 8601 timestamp of the oldest indexed item, used to label how far
   *  back the corpus reaches ("past 3 months", "past 5 years"). `null`
   *  before anything is indexed. */
  oldest_item_date?: string | null;
  last_sync: string | null;
  error: string | null;
}

export interface ConnectRequest {
  path?: string;
  token?: string;
  code?: string;
  email?: string;
  password?: string;
  /** Non-secret connector configuration such as a weather location or RSS feeds. */
  config?: Record<string, unknown>;
  host?: string;
  port?: number;
  security?: 'tls' | 'starttls';
}

/** Response from POST /v1/connectors/{id}/connect.
 *  For OAuth connectors, pasting a Client ID / Secret pair only registers the
 *  app credentials; the backend returns `status: "oauth_required"` plus an
 *  `oauth_start` path the UI must open to run the browser consent flow that
 *  actually mints an access token (see issue #512). */
export interface ConnectResponse {
  connector_id: string;
  connected: boolean;
  status: "connected" | "pending" | "oauth_required" | "disconnected";
  oauth_start?: string;
  sync_status?: string | null;
}

export type WizardStep = "pick" | "connect" | "ingest" | "ready";

// Backward-compatible alias
export type SourceCard = ConnectorMeta;

export type ConnectorCategory = ConnectorMeta['category'];

export const SOURCE_CATALOG: ConnectorMeta[] = [
  // ── Upload / Paste ─────────────────────────────────────────────────
  {
    connector_id: 'upload',
    display_name: "Enviar / colar",
    auth_type: 'filesystem',
    category: 'other',
    icon: 'FileUp',
    color: 'text-blue-400',
    description: "Cole texto ou envie documentos",
    unitLabel: "documentos",
    steps: [
      { label: "Cole texto ou envie arquivos (.txt, .md, .pdf, .docx, .csv) para adicioná-los à sua base de conhecimento." },
    ],
    inputFields: [],
  },
  // ── Communication ──────────────────────────────────────────────────
  {
    // Unified Gmail card. Defaults to the IMAP (app-password) flow because
    // it needs no Google Cloud setup; the OAuth path is offered as an
    // "Advanced" disclosure rendered in DataSourcesPage.
    connector_id: 'gmail_imap',
    display_name: 'Gmail',
    auth_type: 'oauth',
    category: 'communication',
    icon: 'Mail',
    color: 'text-red-400',
    description: "Mensagens e conversas de e-mail",
    unitLabel: "e-mails",
    steps: [
      {
        label: "Ative a verificação em duas etapas e gere uma senha de aplicativo de 16 caracteres (Mail / Other / \"OpenJarvis\"). Cole-a abaixo; espaços são aceitos. Use a senha de aplicativo, não a senha comum do Gmail.",
        url: 'https://myaccount.google.com/apppasswords',
        urlLabel: 'Como obter uma senha de aplicativo \u2192',
      },
    ],
    troubleshooting: [
      "Não encontra a opção de senha de aplicativo? Ative primeiro a verificação em duas etapas.",
      "Usa Google Workspace? O administrador talvez precise permitir senhas de aplicativo na organização.",
    ],
    inputFields: [
      { name: 'email', placeholder: 'you@gmail.com', type: 'text' },
      { name: 'password', placeholder: "Senha do aplicativo (xxxx xxxx xxxx xxxx)", type: 'password' },
    ],
  },
  {
    connector_id: 'imap',
    display_name: "E-mail (IMAP)",
    auth_type: 'oauth',
    category: 'communication',
    icon: 'Mail',
    color: 'text-amber-400',
    description: "Qualquer caixa de e-mail IMAP",
    unitLabel: "e-mails",
    steps: [
      {
        label: "Gere uma senha de aplicativo no seu provedor de e-mail, com IMAP ativado. Depois informe o endereço de e-mail e a senha de aplicativo. Provedores conhecidos são detectados automaticamente; para outros, use as configurações opcionais do servidor.",
      },
    ],
    troubleshooting: [
      'A maioria dos provedores exige uma senha de aplicativo em vez da senha comum.',
      'Use TLS na porta 993 ou STARTTLS na porta 143, conforme o provedor.',
      'Por segurança, endereços de servidor privados ou locais não são aceitos.',
    ],
    inputFields: [
      { name: 'email', placeholder: 'you@example.com', type: 'text' },
      { name: 'password', placeholder: "Senha de aplicativo", type: 'password' },
      {
        name: 'host',
        placeholder: "Host do IMAP (opcional; detectado automaticamente)",
        type: 'text',
        required: false,
      },
      {
        name: 'port',
        placeholder: "Porta (opcional; 993 ou 143)",
        type: 'number',
        required: false,
      },
      {
        name: 'security',
        placeholder: "Segurança da conexão",
        type: 'select',
        defaultValue: 'tls',
        options: [
          { value: 'tls', label: "TLS (geralmente porta 993)" },
          { value: 'starttls', label: "STARTTLS (geralmente porta 143)" },
        ],
      },
    ],
  },
  {
    connector_id: 'slack',
    display_name: 'Slack',
    auth_type: 'oauth',
    category: 'communication',
    icon: 'Hash',
    color: 'text-purple-400',
    description: "Ler mensagens de todos os canais, canais privados e conversas diretas a que você tem acesso",
    unitLabel: "mensagens",
    steps: [
      {
        label: "Vá até api.slack.com/apps e clique em \"Create New App\" → escolha \"From scratch\". Dê o nome \"OpenJarvis\" e selecione seu workspace",
        url: 'https://api.slack.com/apps',
        urlLabel: 'Abrir aplicativos do Slack',
      },
      {
        label: "Na barra lateral esquerda, clique em \"OAuth & Permissions\". Desça até \"User Token Scopes\" (NÃO \"Bot Token Scopes\"). Clique em \"Add an OAuth Scope\" e adicione cada um desses escopos um por um:",
      },
      {
        label: 'channels:history • channels:read • groups:history • groups:read • im:history • im:read • mpim:history • mpim:read • users:read',
      },
      {
        label: "Na barra lateral esquerda, clique em \"Install App\" → clique em \"Install to Workspace\" → clique em \"Allow\". Após a instalação, copie o \"User OAuth Token\" que aparece (começa com xoxp-, NÃO com xoxb-)",
      },
      {
        label: "Cole o token do usuário abaixo. Sincronize os índices de todos os canais, canais privados, DMs e DMs de grupos que você tem acesso — não é necessário convidar ninguém para os canais",
      },
      {
        label: "(Opcional) Defina o ícone da aplicação: na barra lateral esquerda clique em \"Basic Information\" → deslize até \"Display Information\" → suba o logotipo OpenJarvis",
        url: 'https://github.com/open-jarvis/OpenJarvis/blob/main/assets/openjarvis-slack-icon.jpg',
        urlLabel: 'Baixar ícone',
      },
    ],
    inputFields: [
      { name: 'token', placeholder: 'xoxp-...', type: 'password' },
    ],
  },
  {
    connector_id: 'notion',
    display_name: 'Notion',
    auth_type: 'oauth',
    category: 'documents',
    icon: 'FileText',
    color: 'text-gray-300',
    description: "Páginas e bancos de dados",
    unitLabel: "páginas",
    steps: [
      {
        label: "Acesse notion.so/profile/integrations → clique em \"+ New integration\". Nomeie-o \"OpenJarvis\", selecione seu workspace e clique em Submit",
        url: 'https://www.notion.so/profile/integrations',
        urlLabel: 'Abrir integrações do Notion',
      },
      {
        label: "Copie o \"Internal Integration Secret\" (começa por ntn_) e cole abaixo",
      },
      {
        label: "Para compartilhar todas as suas páginas de uma vez: abra qualquer página do nível superior → clique em \"...\" (canto superior direito) → \"Connections\" → \"Add connections\" → procure por \"OpenJarvis\" → clique nele. Isso compartilha a página e todas as suas sub-páginas. Repita para cada página do nível superior, ou compartilhe todo o seu workspace fazendo isso em cada página raiz.",
      },
      {
        label: "Dica: se você tiver apenas uma página do nível superior que contém tudo, compartilhar apenas essa página compartilhará automaticamente todas as sub-páginas aninhadas.",
      },
    ],
    inputFields: [
      { name: 'token', placeholder: 'ntn_...', type: 'password' },
    ],
  },
  {
    connector_id: 'granola',
    display_name: 'Granola',
    auth_type: 'oauth',
    category: 'documents',
    icon: 'Mic',
    color: 'text-amber-400',
    description: "Notas de reuniões com IA",
    unitLabel: "notas de reunião",
    steps: [
      { label: "Abra a aplicação desktop Granola. Clique no ícone de engrenagem (Configurações) na parte inferior-esquerda, depois clique em \"API\"." },
      { label: "Clique em \"Generate API Key\" (ou copie sua chave existente). Cole a chave abaixo." },
    ],
    inputFields: [
      { name: 'token', placeholder: 'grn_...', type: 'password' },
    ],
  },
  {
    connector_id: 'imessage',
    display_name: 'iMessage',
    auth_type: 'local',
    category: 'communication',
    icon: 'MessageSquare',
    color: 'text-green-400',
    description: "Histórico do Mensagens no macOS",
    unitLabel: "mensagens",
    steps: [
      {
        label: "Abra o menu Apple () → Configurações do Sistema → Privacidade e Segurança (na barra lateral à esquerda) → deslize para baixo e clique em \"Full Disk Access\"",
      },
      {
        label: "Clique no botão \"+\" no final da lista. Navegue até Aplicações → Utilitários → selecione \"Terminal.app\" (ou iTerm2/Warp se estiver usando esses). Se estiver usando a aplicação desktop, também adicione \"OpenJarvis.app\" do Aplicações",
      },
      {
        label: "Alternar o interruptor ON ao lado de cada aplicativo adicionado. Fechar e abrir seu terminal (ou reiniciar o OpenJarvis). Os dados do iMessage serão detectados automaticamente — não são necessários credenciais",
      },
    ],
  },
  // ── Documents ──────────────────────────────────────────────────────
  {
    connector_id: 'obsidian',
    display_name: 'Obsidian',
    auth_type: 'filesystem',
    category: 'documents',
    icon: 'FolderOpen',
    color: 'text-purple-300',
    description: "Cofre de notas Markdown",
    unitLabel: "notas",
    steps: [
      {
        label: "Encontre o caminho do seu vault: abra Obsidian → clique no nome do vault na parte inferior-esquerda → \"Manage Vaults\" → veja o caminho mostrado abaixo do nome do seu vault. No macOS, geralmente é ~/Documents/MyVault ou ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault",
      },
      {
        label: "Alternativamente, abra o Finder → navegue até a pasta do seu vault (que contém uma pasta oculta chamada .obsidian). Clique com o botão direito na pasta → \"Copy as Pathname\" para obter o caminho completo",
      },
      {
        label: "Cole o caminho completo abaixo. O OpenJarvis indexará todos os arquivos .md no vault",
      },
    ],
    inputFields: [
      { name: 'path', placeholder: '/Users/you/Documents/MyVault', type: 'text' },
    ],
  },
  {
    connector_id: 'gdrive',
    display_name: 'Google Drive',
    auth_type: 'oauth',
    category: 'documents',
    icon: 'FolderOpen',
    color: 'text-blue-400',
    description: "Documentos, planilhas e arquivos",
    unitLabel: "arquivos",
    steps: [
      {
        label: "Acesse o Google Cloud Console e crie um projeto ou selecione um existente. Dê a ele qualquer nome, como \"OpenJarvis\".",
        url: 'https://console.cloud.google.com/projectcreate',
        urlLabel: 'Criar projeto',
      },
      {
        label: "Habilitar a API do Google Drive: clique no link abaixo, certifique-se de que seu projeto está selecionado na parte superior e depois clique em \"Enable\"",
        url: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
        urlLabel: 'Ativar API do Drive',
      },
      {
        label: "Criar credenciais OAuth: vá para Credenciais (link abaixo) → clique em \"+ Create Credentials\" → escolha \"OAuth client ID\" → Tipo de aplicação: \"Web application\". Na seção \"Authorized redirect URIs\", adicione este callback do servidor do seu OpenJarvis (ex. http://localhost:1313/v1/connectors/gdrive/oauth/callback — ajuste para o host/port que o seu servidor OpenJarvis está bound) → clique em \"Create\".",
        url: 'https://console.cloud.google.com/apis/credentials',
        urlLabel: 'Abrir credenciais',
      },
      {
        label: "Uma janela de diálogo mostrará seu Client ID e Client Secret. Copie ambos e cole abaixo, depois clique em Conectar — uma janela de login do Google abrirá para finalizar a autorização. (Se você perder a janela de diálogo, clique no ícone de download ao lado do seu OAuth client para vê-los novamente.)",
      },
    ],
    inputFields: [
      { name: 'email', placeholder: "Client ID (ex. 123456-abc.apps.googleusercontent.com)", type: 'text' },
      { name: 'password', placeholder: 'Client Secret', type: 'password' },
    ],
  },
  // ── PIM (Calendar, Contacts) ───────────────────────────────────────
  {
    connector_id: 'gcalendar',
    display_name: "Google Agenda",
    auth_type: 'oauth',
    category: 'pim',
    icon: 'Calendar',
    color: 'text-blue-400',
    description: "Eventos e reuniões",
    unitLabel: "eventos",
    steps: [
      {
        label: "Vá para o Console do Google Cloud → use o mesmo projeto que o Google Drive (ou crie um novo)",
        url: 'https://console.cloud.google.com/projectcreate',
        urlLabel: 'Abrir console',
      },
      {
        label: "Habilitar a API do Google Agenda: clique no link abaixo, selecione seu projeto e depois clique em \"Enable\"",
        url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
        urlLabel: 'Ativar API do Google Agenda',
      },
      {
        label: "Vá até Credenciais → \"+ Create Credentials\" (+) → \"OAuth client ID\" → Tipo de aplicativo: \"Desktop app\" → \"Create\". Copie o Client ID e o Client Secret",
        url: 'https://console.cloud.google.com/apis/credentials',
        urlLabel: 'Abrir credenciais',
      },
      {
        label: "Cole abaixo o Client ID e o Client Secret (pode reutilizar o mesmo OAuth client se ambos os APIs foram habilitados no mesmo projeto)",
      },
    ],
    inputFields: [
      { name: 'email', placeholder: 'Client ID', type: 'text' },
      { name: 'password', placeholder: 'Client Secret', type: 'password' },
    ],
  },
  {
    connector_id: 'gcontacts',
    display_name: 'Google Contacts',
    auth_type: 'oauth',
    category: 'pim',
    icon: 'Users',
    color: 'text-blue-400',
    description: "Pessoas e informações de contato",
    unitLabel: "contatos",
    steps: [
      {
        label: "Vá para o Console do Google Cloud → use o mesmo projeto que o Google Drive (ou crie um novo)",
        url: 'https://console.cloud.google.com/projectcreate',
        urlLabel: 'Abrir console',
      },
      {
        label: "Habilitar a API da People: clique no link abaixo, selecione seu projeto e depois clique em \"Enable\"",
        url: 'https://console.cloud.google.com/apis/library/people.googleapis.com',
        urlLabel: 'Ativar API de contatos',
      },
      {
        label: "Vá até Credenciais → \"+ Create Credentials\" (+) → \"OAuth client ID\" → Tipo de aplicativo: \"Desktop app\" → \"Create\". Copie o Client ID e o Client Secret",
        url: 'https://console.cloud.google.com/apis/credentials',
        urlLabel: 'Abrir credenciais',
      },
      {
        label: "Cole o Client ID e o Client Secret abaixo",
      },
    ],
    inputFields: [
      { name: 'email', placeholder: 'Client ID', type: 'text' },
      { name: 'password', placeholder: 'Client Secret', type: 'password' },
    ],
  },
  {
    connector_id: 'apple_notes',
    display_name: 'Apple Notes',
    auth_type: 'local',
    category: 'documents',
    icon: 'FileText',
    color: 'text-yellow-400',
    description: "App Notas do macOS",
    unitLabel: "notas",
    steps: [
      {
        label: "Abra o menu Apple () → Configurações do Sistema → Privacidade e Segurança (na barra lateral à esquerda) → deslize para baixo e clique em \"Full Disk Access\"",
      },
      {
        label: "Clique no botão \"+\" no final da lista. Navegue até Aplicações → Utilitários → selecione \"Terminal.app\" (ou iTerm2/Warp se estiver usando esses). Se estiver usando a aplicação desktop, também adicione \"OpenJarvis.app\" do Aplicações",
      },
      {
        label: "Ative o interruptor ao lado de cada aplicativo adicionado. Feche e abra seu terminal (ou reinicie o OpenJarvis). O Apple Notes será detectado automaticamente — não são necessárias credenciais.",
      },
    ],
  },
  {
    connector_id: 'apple_contacts',
    display_name: 'Apple Contacts',
    auth_type: 'local',
    category: 'pim',
    icon: 'Users',
    color: 'text-orange-400',
    description: "App de Contatos do macOS",
    unitLabel: "contatos",
    steps: [
      {
        label: "Abra o menu Apple () → Configurações do Sistema → Privacidade e Segurança (na barra lateral à esquerda) → deslize para baixo e clique em \"Full Disk Access\"",
      },
      {
        label: "Clique no botão \"+\" no final da lista. Navegue até Aplicações → Utilitários → selecione \"Terminal.app\" (ou iTerm2/Warp se estiver usando esses). Se estiver usando a aplicação desktop, também adicione \"OpenJarvis.app\" do Aplicações",
      },
      {
        label: "Ative o interruptor ao lado de cada aplicativo adicionado. Feche e abra seu terminal (ou reinicie o OpenJarvis). O Apple Contacts será detectado automaticamente — não são necessárias credenciais.",
      },
    ],
  },
  {
    connector_id: 'outlook',
    display_name: 'Outlook',
    auth_type: 'oauth',
    category: 'communication',
    icon: 'Mail',
    color: 'text-blue-400',
    description: "E-mail e calendário da Microsoft",
    unitLabel: "e-mails",
    steps: [
      {
        label: "Vá para o Azure Portal → App Registrations → clique em \"+ New registration\". Nomeie-o \"OpenJarvis\", selecione \"Accounts in this organizational directory only\" e clique em Register",
        url: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
        urlLabel: 'Abrir registros de aplicativos do Azure',
      },
      {
        label: "Na barra lateral esquerda, clique em \"API Permissions\" → \"Add a permission\" → \"Microsoft Graph\" → \"Delegated permissions\" → procure por \"Mail.Read\" → clique em \"Add permissions\"",
      },
      {
        label: "Na barra lateral esquerda, clique em \"Certificates & secrets\" → \"New client secret\" → defina uma descrição e uma data de expiração → clique em \"Add\" → copie imediatamente o \"Value\" (não será mais visível)",
      },
      {
        label: "Vá para \"Overview\" na barra lateral esquerda e copie o \"Application (client) ID\". Cole abaixo tanto o Client ID quanto o Client Secret",
      },
    ],
    inputFields: [
      { name: 'email', placeholder: 'Application (client) ID', type: 'text' },
      { name: 'password', placeholder: 'Client Secret Value', type: 'password' },
    ],
  },
  {
    connector_id: 'dropbox',
    display_name: 'Dropbox',
    auth_type: 'oauth',
    category: 'documents',
    icon: 'FolderOpen',
    color: 'text-blue-300',
    description: "Armazenamento de arquivos na nuvem",
    unitLabel: "arquivos",
    steps: [
      {
        label: "Acesse o Dropbox App Console e clique em \"Create app\". Escolha \"Scoped access\" → \"Full Dropbox\", dê um nome como \"OpenJarvis\" e clique em \"Create app\".",
        url: 'https://www.dropbox.com/developers/apps/create',
        urlLabel: 'Abrir console de aplicativos do Dropbox',
      },
      {
        label: "Abra a aba \"Permissions\". Marque \"files.metadata.read\" e \"files.content.read\" e clique em \"Submit\" para salvar.",
      },
      {
        label: "Volte à aba \"Settings\". Em \"OAuth 2\", localize \"Generated access token\" e clique em \"Generate\". Copie o token e cole-o abaixo.",
      },
    ],
    inputFields: [
      { name: 'token', placeholder: "Token de acesso (sl.u...)", type: 'password' },
    ],
  },
  {
    connector_id: 'whatsapp',
    display_name: 'WhatsApp',
    auth_type: 'oauth',
    category: 'communication',
    icon: 'MessageSquare',
    color: 'text-green-400',
    description: "Mensagens do WhatsApp (API da Meta Cloud)",
    unitLabel: "mensagens",
    steps: [
      {
        label: "Vá para Meta for Developers → clique em \"Create App\" → selecione o tipo \"Business\" → preencha os detalhes do seu aplicativo e clique em \"Create App\"",
        url: 'https://developers.facebook.com/apps/',
        urlLabel: 'Abrir portal de desenvolvedores da Meta',
      },
      {
        label: "No painel do aplicativo, procure por \"WhatsApp\" e clique em \"Set up\". Siga as instruções para adicionar um número de teste do WhatsApp. Vá até \"API Setup\" e copie o token de acesso temporário",
      },
      {
        label: "Copie o \"Phone Number ID\" exibido na página API Setup e o token de acesso. Cole-os abaixo separados por dois-pontos, por exemplo: 123456789:EAABx...",
      },
    ],
    inputFields: [
      { name: 'token', placeholder: 'ID do número:token de acesso', type: 'password' },
    ],
  },
];
