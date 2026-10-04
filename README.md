# E ABRAVANNELY — produção

Esta versão adiciona backend Node.js, banco SQLite, catálogo persistente, estoque, pedidos e integração preparada com Mercado Pago Checkout Pro.

## 1. Requisitos
- Node.js 18+
- Uma conta de vendedor no Mercado Pago (o titular da conta deve ser um adulto/responsável legal quando isso for exigido).

## 2. Instalar
```bash
npm install
```

## 3. Configurar
Copie `.env.example` para `.env` e preencha:
- `MP_ACCESS_TOKEN`: chave privada do Mercado Pago, SOMENTE no servidor.
- `BASE_URL`: URL pública da loja.
- `MP_WEBHOOK_URL`: URL HTTPS pública para notificações.
- `ADMIN_PASSWORD`: senha do painel.

Nunca publique `.env` nem coloque o Access Token no HTML/JavaScript.

## 4. Rodar
```bash
npm start
```
Abra `http://localhost:3000`.

## 5. Pagamento
O endpoint `/api/checkout` cria uma preferência no Mercado Pago e retorna o `init_point`. O cliente é redirecionado ao checkout seguro. O webhook consulta o pagamento e atualiza o pedido/estoque.

Para produção, configure uma URL HTTPS pública e a notificação do Mercado Pago. Também valide a assinatura das notificações de acordo com a documentação atual antes de considerar o webhook pronto para dinheiro real.

## 6. Administração
Esta versão já possui endpoints protegidos por `x-admin-password`, mas ainda não tem uma tela de login administrativa. Para uma loja pública, recomenda-se adicionar autenticação de usuário com sessão segura, hash de senha, proteção contra tentativas e banco PostgreSQL/Supabase.

## 7. Banco
SQLite funciona bem para protótipo/servidor pequeno. Para escala, migre para PostgreSQL.

### Documentação oficial usada como referência
Mercado Pago SDK Node.js e Checkout Pro:
https://github.com/mercadopago/sdk-nodejs
https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order
