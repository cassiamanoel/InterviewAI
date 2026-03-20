import asyncio
import time
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.rag_service import RAGService

async def simulate_rag_request(user_id: str, question: str):
    start = time.time()
    try:
        # Mocking or hitting real RAG depends on env
        # ask_question is synchronous, so we offload it
        result = await asyncio.to_thread(
            RAGService.ask_question,
            user_id=user_id, 
            question=question
        )
        latency = time.time() - start
        return True, latency, result
    except Exception as e:
        latency = time.time() - start
        return False, latency, str(e)

async def run_rag_stress_test(concurrency: int = 10):
    print(f"Starting RAG stress test with concurrency={concurrency}...")
    
    # We use a dummy user ID
    user_id = "00000000-0000-0000-0000-000000000000"
    question = "Quais as principais habilidades listadas no meu CV?"
    
    tasks = [simulate_rag_request(user_id, question) for _ in range(concurrency)]
    
    results = await asyncio.gather(*tasks)
    
    success_count = sum(1 for r in results if r[0])
    error_count = sum(1 for r in results if not r[0])
    latencies = [r[1] for r in results if r[0]]
    
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    max_latency = max(latencies) if latencies else 0
    
    print("\n--- RAG Stress Test Results ---")
    print(f"Total Requests: {concurrency}")
    print(f"Successful: {success_count}")
    print(f"Failed: {error_count}")
    print(f"Avg Latency (Success): {avg_latency*1000:.2f} ms")
    print(f"Max Latency (Success): {max_latency*1000:.2f} ms")
    
    if error_count > 0:
        errors = set([r[2] for r in results if not r[0]])
        print(f"Unique Errors: {errors}")

if __name__ == "__main__":
    # Depending on environment, you might want to mock OpenAI here
    # to avoid extreme billing, or use a smaller concurrency.
    asyncio.run(run_rag_stress_test(10))
