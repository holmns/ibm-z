import os
import json
import sqlite3
import time
import requests

# Configuration
INPUT_DB = "hazewise.db"
OUTPUT_DB = "activity_embeddings.db"
MODEL = "openai/text-embedding-3-large"
API_URL = "https://openrouter.ai/api/v1/embeddings"

API_KEY = os.getenv("OPENROUTER_API_KEY")

if not API_KEY:
    raise ValueError("Set the OPENROUTER_API_KEY environment variable.")

BATCH_SIZE = 50
MAX_RETRIES = 5

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}


def get_embeddings(texts):
    """Generate embeddings for a batch of texts using OpenRouter."""
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                API_URL,
                headers=HEADERS,
                json={
                    "model": MODEL,
                    "input": texts,
                    "encoding_format": "float",
                },
                timeout=120,
            )

            response.raise_for_status()
            result = response.json()["data"]

            # Sort by input index to preserve correspondence with texts.
            result.sort(key=lambda item: item["index"])

            return [item["embedding"] for item in result]

        except (requests.RequestException, KeyError, ValueError) as e:
            if attempt == MAX_RETRIES - 1:
                raise RuntimeError(
                    f"Embedding request failed after {MAX_RETRIES} attempts: {e}"
                ) from e

            wait = 2**attempt
            print(f"Request failed: {e}. Retrying in {wait}s...")
            time.sleep(wait)


def main():
    # Connect to the source database.
    source = sqlite3.connect(INPUT_DB)
    source.row_factory = sqlite3.Row

    # Create the output database.
    output = sqlite3.connect(OUTPUT_DB)

    output.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            code TEXT PRIMARY KEY,
            embedding TEXT NOT NULL
        )
    """)
    output.commit()

    # Fetch activities that have descriptions and are not yet embedded.
    rows = source.execute("""
        SELECT code, description
        FROM activities
        WHERE description IS NOT NULL
          AND TRIM(description) != ''
    """).fetchall()

    pending = [
        row
        for row in rows
        if not output.execute(
            "SELECT 1 FROM embeddings WHERE code = ?",
            (row["code"],),
        ).fetchone()
    ]

    total = len(pending)
    print(f"Total activities: {len(rows)}")
    print(f"Already embedded: {len(rows) - total}")
    print(f"Remaining: {total}")

    try:
        for start in range(0, total, BATCH_SIZE):
            batch = pending[start : start + BATCH_SIZE]

            texts = [row["description"] for row in batch]
            embeddings = get_embeddings(texts)

            if not embeddings:
                raise RuntimeError("No embeddings returned from the API.")

            if len(embeddings) != len(batch):
                raise RuntimeError("Embedding count does not match batch size.")

            with output:
                output.executemany(
                    """
                    INSERT OR REPLACE INTO embeddings (code, embedding)
                    VALUES (?, ?)
                    """,
                    [
                        (row["code"], json.dumps(embedding))
                        for row, embedding in zip(batch, embeddings)
                    ],
                )

            processed = min(start + len(batch), total)
            print(f"Progress: {processed}/{total}")

    finally:
        source.close()
        output.close()

    print(f"Done! Embeddings saved to {OUTPUT_DB}")


if __name__ == "__main__":
    main()
