import time
import random
import httpx

RETRY_STATUS = {429, 500, 502, 503, 504}

def post_with_retry(url: str, headers: dict, payload: dict, timeout: int = 60, max_retries: int = 6):
    delay = 0.5
    last_exc = None

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                r = client.post(url, headers=headers, json=payload)

            if r.status_code in RETRY_STATUS:
                raise httpx.HTTPStatusError("retryable_status", request=r.request, response=r)

            r.raise_for_status()
            return r.json()

        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as e:
            last_exc = e
            # backoff com jitter
            sleep_s = delay * (2 ** attempt) + random.uniform(0, 0.25)
            time.sleep(min(sleep_s, 10))

    raise last_exc