from app.db.session import engine, Base
from app.db import models  # IMPORTANTE: importa models para registrar tabelas

Base.metadata.create_all(bind=engine)

print("Tabelas criadas com sucesso")