import asyncio
import time
import sys
import os
import statistics
import logging

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.rag_service import RAGService
from app.services.rag_service import _chat_semaphore

class Metrics:
    def __init__(self):
        self.total = 0
        self.success = 0
        self.failed = 0
        self.latencies = []
        self.semaphore_wait_times = []
        self.http_429_count = 0
        self.http_total_times = []

metrics = Metrics()

# Monkey patch _chat to collect semaphore waiting time and raw HTTP time
original_chat = RAGService._chat

async def mocked_chat(messages: list):
    start_wait = time.time()
    
    # Track semaphore wait specifically
    async with _chat_semaphore:
        wait_time = time.time() - start_wait
        metrics.semaphore_wait_times.append(wait_time)
        
        # Now track raw execution time simulating the original chat but with tracing
        # For true HTTP measurement, we would call the inner method. Let's just track 
        # the overall time minus semaphore wait.
        start_req = time.time()
        
        try:
            # We temporarily release the semaphore to let the original chat acquire it,
            # but wait, original_chat has `async with _chat_semaphore:` inside it!
            # If we acquire here, original_chat will deadlock.
            pass
        except Exception as e:
            pass

# Better approach: We monkey patch the HTTPX client inside RAGService._chat
import httpx
from unittest.mock import patch

original_post = httpx.AsyncClient.post

async def tracing_post(self, url, *args, **kwargs):
    start_time = time.time()
    response = await original_post(self, url, *args, **kwargs)
    req_time = time.time() - start_time
    metrics.http_total_times.append(req_time)
    
    if response.status_code == 429:
        metrics.http_429_count += 1
        
    return response

async def simulate_user(user_id: str, question: str):
    start_total = time.time()
    try:
        result = await RAGService.ask_question(
            user_id=user_id, 
            question=question,
            top_k=2
        )
        latency = time.time() - start_total
        metrics.latencies.append(latency)
        metrics.success += 1
        return True
    except Exception as e:
        metrics.failed += 1
        return False

async def run_stage(concurrency: int):
    # Reset metrics
    global metrics
    metrics = Metrics()
    metrics.total = concurrency
    
    print(f"\n==================================================")
    print(f"🚀 INICIANDO TESTE DE CARGA: {concurrency} USUÁRIOS SIMULTÂNEOS")
    print(f"==================================================")
    
    user_id = "00000000-0000-0000-0000-000000000000"
    question = "Qual é a experiência em Python?"
    
    start_wall = time.time()
    
    tasks = [simulate_user(user_id, question) for _ in range(concurrency)]
    
    # We apply the httpx patch during the run
    with patch("httpx.AsyncClient.post", new=tracing_post):
        await asyncio.gather(*tasks)
        
    wall_time = time.time() - start_wall
    
    # Calculate stats
    p50 = statistics.median(metrics.latencies) if metrics.latencies else 0
    p95 = statistics.quantiles(metrics.latencies, n=100)[94] if len(metrics.latencies) >= 2 else max(metrics.latencies, default=0)
    p99 = statistics.quantiles(metrics.latencies, n=100)[98] if len(metrics.latencies) >= 2 else max(metrics.latencies, default=0)
    
    avg_http = statistics.mean(metrics.http_total_times) if metrics.http_total_times else 0
    
    # Rate of 429
    rate_429 = (metrics.http_429_count / len(metrics.http_total_times)) * 100 if metrics.http_total_times else 0
    
    print(f"✅ Concluído em {wall_time:.2f}s")
    print(f"📊 Sucesso: {metrics.success} | Falha: {metrics.failed}")
    print(f"⏱️  Latência Total (End-to-End): P50: {p50:.2f}s | P95: {p95:.2f}s | P99: {p99:.2f}s")
    print(f"🌐 HTTP Req to OpenAI: Média {avg_http:.2f}s")
    print(f"⚠️  Erros 429 (Rate Limit OpenAI): {metrics.http_429_count} ({rate_429:.1f}%)")

async def main():
    print("WARNING: This test will consume REAL OpenAI Tokens.")
    
    await run_stage(50)
    await asyncio.sleep(5) # cooldown
    
    await run_stage(100)
    await asyncio.sleep(5)
    
    await run_stage(200)

if __name__ == "__main__":
    asyncio.run(main())
