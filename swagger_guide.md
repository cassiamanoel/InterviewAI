# Guia de Endpoints e Testes no Swagger (Interview AI)

Este documento explica as principais rotas disponíveis na API (disponíveis via Swagger) e para que servem no contexto do aplicativo.

## 🛡️ Autenticação & Usuários (`/auth`)

### 1. `POST /auth/register` (Registrar Usuário)
*   **O que faz:** Cria uma nova conta de usuário no banco de dados (PostgreSQL). Recebe email e senha, gera um "hash" seguro (criptografia) dessa senha e cria o registro do usuário na tabela `users`.
*   **Uso Prático:** Integrado à tela de "Criar Conta" do front-end.

### 2. `POST /auth/login` (Fazer Login / Gerar Token)
*   **O que faz:** Essa é a rota central da segurança. Recebe o email e a senha, verifica no banco de dados se estão corretos e, se estiverem, devolve um **Token JWT** (chave de segurança temporária). O Swagger usa essa rota ("Authorize") para habilitar o uso das demais rotas protegidas.
*   **Uso Prático:** Integrado à tela de "Entrar". O front-end salva o token retornado e o envia nas próximas requisições.

### 3. `GET /auth/me` (Meu Perfil)
*   **O que faz:** Exige que o usuário esteja autenticado (Token JWT). Lê o Token, verifica a identidade do usuário e devolve seus dados (ID, email, plano atual, etc).
*   **Uso Prático:** Logo após o login ou ao abrir o app, o front-end chama essa rota para carregar os dados do usuário ("Olá, [Email]").

---

## 📄 Currículos (`/cv`)

### 4. `POST /cv/upload` (Enviar Currículo)
*   **O que faz:** Permite que o usuário logado envie o PDF ou TXT do seu currículo. O processamento inclui:
    1. O arquivo é lido e extraído.
    2. O texto é quebrado em "pedaços" (chunks).
    3. Esses pedaços são transformados em números (Embeddings) via OpenAI.
    4. Os números são salvos no banco de dados vetorial **Qdrant**.
    5. O arquivo também é salvo no PostgreSQL como o currículo "ativo" do usuário.
*   **Uso Prático:** A tela onde o candidato faz upload do seu currículo para iniciar a entrevista.

### 5. `GET /cv/me` (Ver Currículo Ativo)
*   **O que faz:** Retorna os dados do currículo atualmente salvo pelo usuário logado.
*   **Uso Prático:** Exibição no front-end para que o usuário saiba qual arquivo enviou.

---

## 💬 Entrevista & IA (`/interview`)

### 6. `POST /interview/ask` (Perguntar / Fazer Entrevista)
*   **O que faz:** Funcionalidade central da Inteligência Artificial (SaaS). 
    1. Verifica no **Redis** e no PostgreSQL se o usuário atingiu o limite de perguntas (Rate Limit).
    2. Usa a pergunta recebida e busca no **Qdrant** os trechos do currículo que dão contexto à resposta.
    3. Envia o contexto + a pergunta para o **ChatGPT (OpenAI)** agir como recrutador.
    4. Atualiza o uso de tokens da OpenAI na conta do cliente, permitindo controlar abusos no plano Free.
    5. Devolve a resposta do recrutador em texto.
*   **Uso Prático:** O chat principal da plataforma onde o usuário conversa com o entrevistador virtual.

---

## 💳 Pagamentos / Assinatura (`/billing`)

### 7. `POST /billing/checkout` (Comprar Plano Pro)
*   **O que faz:** Gera um link seguro da **Stripe** para pagamento. Recebe a requisição do plano desejado e devolve uma URL para checkout na Stripe.
*   **Uso Prático:** Botão "Dar Upgrade para Pro" na plataforma.

### 8. `POST /billing/webhook` (Aviso da Stripe)
*   **O que faz:** Esta rota é de uso exclusivo da Stripe, funcionando nos bastidores. Quando um pagamento é aprovado, a Stripe chama este webhook para avisar: *"O cliente joao@email.com acabou de pagar o Plano Pro!"*. A API então altera o banco de dados ativando a assinatura do usuário.

---

## 🏥 Sistema (`/health`)

### 9. `GET /health` (Saúde do Sistema)
*   **O que faz:** Rota pública de verificação ("Estou vivo"). Checa se o banco de dados PostgreSQL e o Redis estão conectados.
*   **Uso Prático:** Usado por serviços de nuvem (Load Balancers, AWS, Docker) para monitorar automaticamente se a aplicação travou e precisa ser reiniciada.

---

## 🚀 Como testar no Swagger (http://localhost:8000/docs)

1. Crie um usuário usando `POST /auth/register` (não precisa de token).
2. Suba até o topo da página, clique no botão **"Authorize"** (Cadeado), preencha `username` com o email e a `password` criada. Clique em Authorize.
3. Agora você está autenticado! Teste o `POST /cv/upload` (subindo um PDF) e o `POST /interview/ask` (fazendo uma pergunta para a IA testar o currículo).
