"""Persistent semantic vector store for FinSense AI."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import chromadb
import requests
from dotenv import load_dotenv

try:
    from .build_documents import DOCUMENTS_PATH, build_stock_document, load_documents
except ImportError:
    import sys

    PIPELINE_ROOT = Path(__file__).resolve().parent
    if str(PIPELINE_ROOT) not in sys.path:
        sys.path.insert(0, str(PIPELINE_ROOT))
    from build_documents import DOCUMENTS_PATH, build_stock_document, load_documents


ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ROOT_ENV_PATH)

CHROMA_DIR = Path(__file__).resolve().parents[1] / "chroma_db"
LEGACY_STORE_PATH = CHROMA_DIR / "stocks_collection.json"
EMBED_CACHE_PATH = Path(__file__).resolve().parent / "data" / "embedding_cache.json"
COLLECTION_NAME = "stocks_collection"
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or "gemini-embedding-001"
EMBEDDING_PROVIDER = (os.getenv("EMBEDDING_PROVIDER") or "gemini").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")


def ensure_store_parent() -> None:
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    EMBED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_client() -> chromadb.PersistentClient:
    ensure_store_parent()
    return chromadb.PersistentClient(path=str(CHROMA_DIR))


def get_collection():
    return get_client().get_or_create_collection(name=COLLECTION_NAME)


def _load_embedding_cache() -> dict[str, list[float]]:
    if not EMBED_CACHE_PATH.exists():
        return {}

    try:
        with EMBED_CACHE_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}

    return payload if isinstance(payload, dict) else {}


def _save_embedding_cache(payload: dict[str, list[float]]) -> None:
    ensure_store_parent()
    with EMBED_CACHE_PATH.open("w", encoding="utf-8") as file:
        json.dump(payload, file)


def _embedding_cache_key(text: str, task_type: str) -> str:
    digest = hashlib.sha256(f"{EMBEDDING_MODEL}:{task_type}:{text}".encode("utf-8")).hexdigest()
    return digest


def _embed_with_gemini(text: str, task_type: str) -> list[float]:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is required for semantic embeddings.")

    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent",
        params={"key": GEMINI_API_KEY},
        json={
            "model": f"models/{EMBEDDING_MODEL}",
            "content": {
                "parts": [{"text": text}],
            },
            "taskType": task_type,
        },
        timeout=45,
    )
    response.raise_for_status()
    payload = response.json()
    values = (payload.get("embedding") or {}).get("values") or []

    if not values:
        raise RuntimeError("Embedding API returned no values.")

    return values


def embed_text(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    if not text.strip():
        return []

    cache = _load_embedding_cache()
    key = _embedding_cache_key(text, task_type)
    cached = cache.get(key)
    if cached:
        return cached

    if EMBEDDING_PROVIDER != "gemini":
        raise RuntimeError(f"Unsupported embedding provider: {EMBEDDING_PROVIDER}")

    vector = _embed_with_gemini(text, task_type)
    cache[key] = vector
    _save_embedding_cache(cache)
    return vector


def _document_to_store_item(document: dict[str, Any]) -> dict[str, Any]:
    metadata = {
        "symbol": document.get("symbol"),
        "company_name": document.get("company_name"),
        "base_symbol": document.get("base_symbol"),
        "updated_at": document.get("updated_at"),
        "market_valid": bool(document.get("market", {}).get("is_valid")),
        "news_valid": bool(document.get("news", {}).get("is_valid")),
        "trend": document.get("market", {}).get("trend") or "",
        "overall_sentiment": document.get("news", {}).get("overall_sentiment") or "",
        "hype_label": document.get("news", {}).get("hype_label") or "",
        "document_json": json.dumps(document, ensure_ascii=False),
    }

    return {
        "id": document.get("id"),
        "symbol": document.get("symbol"),
        "company_name": document.get("company_name"),
        "updated_at": document.get("updated_at"),
        "text": document.get("document_text", ""),
        "embedding": embed_text(document.get("document_text", ""), task_type="RETRIEVAL_DOCUMENT"),
        "metadata": metadata,
        "document": document,
    }


def _store_record_to_item(record_id: str, document_text: str, metadata: dict[str, Any] | None) -> dict[str, Any]:
    metadata = metadata or {}
    document_json = metadata.get("document_json")
    document = json.loads(document_json) if document_json else None

    return {
        "id": record_id,
        "symbol": metadata.get("symbol"),
        "company_name": metadata.get("company_name"),
        "updated_at": metadata.get("updated_at"),
        "text": document_text or "",
        "metadata": {
            "base_symbol": metadata.get("base_symbol"),
            "market_valid": metadata.get("market_valid"),
            "news_valid": metadata.get("news_valid"),
            "trend": metadata.get("trend"),
            "overall_sentiment": metadata.get("overall_sentiment"),
            "hype_label": metadata.get("hype_label"),
        },
        "document": document,
    }


def _migrate_legacy_store_if_needed() -> None:
    collection = get_collection()
    if collection.count() > 0 or not LEGACY_STORE_PATH.exists():
        return

    try:
        with LEGACY_STORE_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return

    items = payload.get("items", []) if isinstance(payload, dict) else []
    documents = []
    for item in items:
        document = item.get("document")
        if isinstance(document, dict) and document.get("id"):
            documents.append(document)

    if documents:
        upsert_documents(documents)


def upsert_documents(documents: list[dict[str, Any]]) -> dict[str, Any]:
    if not documents:
        return get_store_stats()

    collection = get_collection()

    ids = []
    texts = []
    embeddings = []
    metadatas = []

    for document in documents:
        item = _document_to_store_item(document)
        ids.append(item["id"])
        texts.append(item["text"])
        embeddings.append(item["embedding"])
        metadatas.append(item["metadata"])

    collection.upsert(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas,
    )

    return get_store_stats()


def get_item_by_symbol(symbol: str) -> dict[str, Any] | None:
    _migrate_legacy_store_if_needed()
    normalized_symbol = (symbol or "").strip().upper()
    if not normalized_symbol:
        return None

    collection = get_collection()
    result = collection.get(ids=[normalized_symbol])

    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []

    if not ids:
        return None

    return _store_record_to_item(ids[0], documents[0] if documents else "", metadatas[0] if metadatas else {})


def upsert_single_stock(
    symbol: str,
    company_name: str = "",
    include_news: bool = True,
    refresh_news: bool | None = None,
) -> dict[str, Any]:
    existing_item = get_item_by_symbol(symbol)
    existing_document = existing_item.get("document") if existing_item else None
    document = build_stock_document(
        symbol,
        company_name=company_name,
        include_news=include_news,
        existing_document=existing_document,
        refresh_news=refresh_news,
    )
    upsert_documents([document])
    item = get_item_by_symbol(document.get("id", symbol))
    if not item:
        raise RuntimeError(f"Unable to load stored item for {symbol}.")
    return item


def rebuild_from_documents(path: Path = DOCUMENTS_PATH) -> dict[str, Any]:
    documents = load_documents(path)
    return upsert_documents(documents)


def get_store_stats() -> dict[str, Any]:
    _migrate_legacy_store_if_needed()
    collection = get_collection()
    count = collection.count()
    sample = collection.get(limit=1, include=["embeddings"])
    dimension = 0

    sample_embeddings = sample.get("embeddings")
    if sample_embeddings is not None and len(sample_embeddings) > 0:
        first_embedding = sample_embeddings[0]
        if first_embedding is not None and len(first_embedding) > 0:
            dimension = len(first_embedding)

    return {
        "store_path": str(CHROMA_DIR),
        "collection_name": COLLECTION_NAME,
        "provider": EMBEDDING_PROVIDER,
        "embedding_model": EMBEDDING_MODEL,
        "dimension": dimension,
        "item_count": count,
    }


def query_store(
    query: str,
    limit: int = 5,
    where: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    _migrate_legacy_store_if_needed()
    collection = get_collection()
    query_embedding = embed_text(query, task_type="RETRIEVAL_QUERY") if query else None

    kwargs: dict[str, Any] = {
        "n_results": max(limit, 1),
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where

    if query_embedding:
        result = collection.query(query_embeddings=[query_embedding], **kwargs)
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        items = []
        for idx, record_id in enumerate(ids):
            item = _store_record_to_item(record_id, documents[idx], metadatas[idx])
            distance = distances[idx] if idx < len(distances) else None
            score = 0.0 if distance is None else max(0.0, 1.0 - float(distance))
            item["score"] = round(score, 6)
            items.append(item)
        return items

    result = collection.get(where=where, limit=max(limit, 1), include=["documents", "metadatas"])
    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []
    return [
        {
            **_store_record_to_item(record_id, documents[idx], metadatas[idx]),
            "score": 0.0,
        }
        for idx, record_id in enumerate(ids)
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage FinSense AI vector store.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    rebuild_parser = subparsers.add_parser("rebuild", help="Rebuild the store from latest documents.")
    rebuild_parser.add_argument("--documents-path", default=str(DOCUMENTS_PATH))

    stock_parser = subparsers.add_parser("stock", help="Upsert one stock document.")
    stock_parser.add_argument("symbol")
    stock_parser.add_argument("--company-name", default="")
    stock_parser.add_argument("--skip-news", action="store_true")

    subparsers.add_parser("stats", help="Inspect the vector store.")

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.command == "rebuild":
        payload = rebuild_from_documents(Path(args.documents_path))
        print(json.dumps(payload, ensure_ascii=False))
        return

    if args.command == "stats":
        print(json.dumps(get_store_stats(), ensure_ascii=False))
        return

    item = upsert_single_stock(
        args.symbol,
        company_name=args.company_name,
        include_news=not args.skip_news,
        refresh_news=None,
    )
    print(json.dumps(item, ensure_ascii=False))


if __name__ == "__main__":
    main()
