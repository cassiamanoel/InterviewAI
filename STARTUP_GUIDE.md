# Guia de Inicialização - Interview AI

Siga os passos abaixo para colocar toda a aplicação no ar.

## 1. Infraestrutura (Docker)
Este passo sobe o Banco de Dados (Postgres), Redis e Qdrant.

1. Abra um terminal no diretório `backend`.
2. Execute:
   ```bash
   docker-compose up -d
   ```

## 2. Configuração do Banco de Dados (Migrations)
**Obrigatório na primeira execução** ou quando houver erro de "relation does not exist".

1. No mesmo terminal do `backend`:
2. Ative o ambiente virtual:
   ```powershell
   .\venv\Scripts\activate
   ```
3. Execute as migrations:
   ```powershell
   alembic upgrade head
   ```

## 3. Backend (API FastAPI)
1. Com o ambiente virtual ativado (`.\venv\Scripts\activate`), execute:
   ```powershell
   uvicorn app.main:app --reload
   ```
2. O backend estará disponível em: [http://localhost:8000](http://localhost:8000)
3. Documentação (Swagger): [http://localhost:8000/docs](http://localhost:8000/docs)

## 4. Frontend (Next.js)
1. Abra um novo terminal no diretório `frontend`.
2. Execute:
   ```bash
   npm run dev
   ```
3. O frontend estará disponível em: [http://localhost:3000](http://localhost:3000)

---
### Endpoints de Verificação
- **Saúde do Sistema**: [http://localhost:8000/health](http://localhost:8000/health)
- **Frontend**: [http://localhost:3000](http://localhost:3000)
