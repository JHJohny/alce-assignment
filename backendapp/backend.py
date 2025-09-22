from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Mini API", version="1.0.0")

class EchoIn(BaseModel):
    message: str

FAKE_DB = {1: {"id": 1, "name": "Alpha"}, 2: {"id": 2, "name": "Beta"}}

@app.get("/health")
def ping():
    return {"status": "ok"}

@app.get("/items/{item_id}")
def get_item(item_id: int):
    item = FAKE_DB.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@app.post("/echo")
def echo(body: EchoIn):
    return {"you_said": body.message}
