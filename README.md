
Middleware Node.js que conecta o **Zendesk** à **ZapSign**, permitindo criar e enviar documentos para assinatura eletrônica diretamente a partir de tickets.

## Fluxo


Ticket Zendesk ──► Webhook ──► Middleware ──► API ZapSign ──► Documento criado
                                                                    │
Ticket atualizado ◄── Middleware ◄── Webhook ZapSign ◄── Assinado ◄─┘




1. Ticket de reembolso criado
2. Zendesk dispara um webhook com os dados do ticket
3. Este middleware recebe os dados, monta o payload e chama a API da ZapSign
4. A ZapSign cria o documento e envia o link de assinatura ao cliente por e-mail ou WPP
5. Quando o cliente assina, a ZapSign notifica este middleware via webhook
6. O middleware atualiza o ticket no Zendesk com o status da assinatura
