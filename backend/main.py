from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_frontend_url
from local_db import init_db
from routes import analytics, auth, levels, market, oi, option_chain, pcr, scheduler, sentiment
from scheduler import option_scheduler


logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    option_scheduler.start_engine()
    yield
    option_scheduler.shutdown()


app = FastAPI(title="Options Analytics Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_frontend_url()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(scheduler.router)
app.include_router(option_chain.router)
app.include_router(pcr.router)
app.include_router(oi.router)
app.include_router(levels.router)
app.include_router(sentiment.router)
app.include_router(analytics.router)
app.include_router(market.router)
