import sys
import os
sys.path.append(os.getcwd())
from app.db.session import SessionLocal
from app.db.models import User
from app.routes.interview import ask
from app.schemas.interview_schema import AskRequest

def test():
    db = SessionLocal()
    # Get any user
    user = db.query(User).first()
    if not user:
        print("No user found in DB")
        return
    
    req = AskRequest(question="há quantos anos trabalha com java?")
    try:
        res = ask(body=req, db=db, current_user=user)
        print(res)
    except Exception as e:
        import traceback
        traceback.print_exc()

test()
