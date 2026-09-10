"""FinRobot-style analyst orchestration for FinSense AI.

This module keeps the integration lightweight: it applies FinRobot's agent
pattern over the existing market/news/RAG document, then optionally asks an LLM
to turn the structured reasoning into a final user-facing answer.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import requests
from dotenv import load_dotenv
from pathlib import Path


ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ROOT_ENV_PATH)


def _safe_number(value: Any, digits: int = 2) -> str:
    try:
        if value is None:
            return "unknown"
        return str(round(float(value), digits))
    except (TypeError, ValueError):
        return "unknown"


def build_agent_context(document: dict[str, Any], query: str) -> dict[str, Any]:
    market = document.get("market") or {}
    news = document.get("news") or {}
    analysis = document.get("analysis") or {}
    headlines = news.get("top_headlines") or []

    data_cot = [
        f"Stock: {document.get('symbol')}",
        f"Company: {document.get('company_name')}",
        f"Market validity: {bool(market.get('is_valid'))}",
        f"Price: {_safe_number(market.get('price'))}",
        f"Trend: {market.get('trend') or 'Unknown'}",
        f"RSI: {_safe_number(market.get('rsi'))}",
        f"News validity: {bool(news.get('is_valid'))}",
        f"Sentiment: {news.get('overall_sentiment') or 'Unknown'}",
        f"Hype label: {news.get('hype_label') or 'Unknown'}",
    ]

    concept_cot = [
        analysis.get("recommendation") or "Recommendation unavailable.",
        analysis.get("market_summary") or "Market summary unavailable.",
        analysis.get("news_summary") or "News summary unavailable.",
    ]

    thesis_cot = [
        "Use the evidence to explain the setup, risks, and next checks.",
        "Do not provide guaranteed returns or personalized financial advice.",
        "Prefer cautious, decision-support language.",
    ]

    return {
        "query": query,
        "data_cot": data_cot,
        "concept_cot": concept_cot,
        "thesis_cot": thesis_cot,
        "top_headlines": [
            {
                "headline": item.get("headline"),
                "source": item.get("source"),
                "sentiment": item.get("sentiment"),
                "published_date": item.get("published_date"),
            }
            for item in headlines[:5]
        ],
    }


def _build_prompt(context: dict[str, Any]) -> str:
    return "\n".join(
        [
            "You are FinSense AI, a supervised financial decision-intelligence analyst.",
            "Use this FinRobot-style reasoning stack to answer the user's question.",
            "Write in plain text only.",
            "Do not use markdown, bullets, asterisks, numbered lists, or headings.",
            "Keep the answer compact and readable in 2 to 4 short paragraphs.",
            "",
            f"User question: {context.get('query')}",
            "",
            "Data-CoT:",
            *[f"- {item}" for item in context.get("data_cot", [])],
            "",
            "Concept-CoT:",
            *[f"- {item}" for item in context.get("concept_cot", [])],
            "",
            "Thesis-CoT rules:",
            *[f"- {item}" for item in context.get("thesis_cot", [])],
            "",
            "Top headlines:",
            *[
                f"- {item.get('headline')} ({item.get('sentiment')} via {item.get('source')})"
                for item in context.get("top_headlines", [])
                if item.get("headline")
            ],
            "",
            "Return a concise direct answer covering view, evidence, risks, and next action in normal prose.",
        ]
    )


def _fallback_response(context: dict[str, Any]) -> str:
    data = "\n".join(f"- {item}" for item in context.get("data_cot", []))
    concepts = "\n".join(f"- {item}" for item in context.get("concept_cot", [])[:2])

    return (
        "Primary LLM response is unavailable, so this is a deterministic FinRobot-style summary.\n\n"
        f"View:\n{concepts}\n\n"
        f"Evidence:\n{data}\n\n"
        "Risks:\n- Validate news quality, valuation, and your portfolio exposure before acting.\n\n"
        "Next action:\n- Treat this as research support, not a buy/sell instruction."
    )


def _call_openai_compatible(prompt: str) -> str:
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = (os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL") or "gpt-4o-mini"

    if not api_key:
        raise RuntimeError("LLM_API_KEY or OPENAI_API_KEY is not configured.")

    response = requests.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a careful financial analyst."},
                {"role": "user", "content": prompt},
            ],
            "temperature": float(os.getenv("LLM_TEMPERATURE") or 0.2),
        },
        timeout=45,
    )
    response.raise_for_status()
    payload = response.json()
    return payload["choices"][0]["message"]["content"].strip()


def _call_gemini(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL") or "gemini-1.5-flash"
    timeout_seconds = max(int(os.getenv("LLM_TIMEOUT_SECONDS") or 90), 30)
    retry_count = max(int(os.getenv("LLM_RETRY_COUNT") or 2), 1)

    if not api_key:
        raise RuntimeError("GEMINI_API_KEY or LLM_API_KEY is not configured.")

    last_error: Exception | None = None

    for attempt in range(retry_count):
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            return payload["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as error:
            last_error = error
            if attempt >= retry_count - 1:
                break
            time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(str(last_error) if last_error else "Gemini request failed.")


def _call_ollama(prompt: str) -> str:
    base_url = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    model = os.getenv("LLM_MODEL") or "llama3.1"
    response = requests.post(
        f"{base_url}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=60,
    )
    response.raise_for_status()
    return response.json().get("response", "").strip()


def generate_finrobot_response(document: dict[str, Any], query: str) -> dict[str, Any]:
    context = build_agent_context(document, query)
    prompt = _build_prompt(context)
    provider = (os.getenv("LLM_PROVIDER") or "fallback").strip().lower()
    model = os.getenv("LLM_MODEL") or provider

    try:
        if provider in {"openai", "openai-compatible", "groq", "together"}:
            answer = _call_openai_compatible(prompt)
        elif provider == "gemini":
            answer = _call_gemini(prompt)
        elif provider == "ollama":
            answer = _call_ollama(prompt)
        else:
            answer = _fallback_response(context)
            provider = "fallback"
            model = "deterministic"
    except Exception as error:
        answer = _fallback_response(context)
        provider = "fallback"
        model = "deterministic"
        context["llm_error"] = str(error)

    return {
        "provider": provider,
        "model": model,
        "architecture": "finrobot_style_data_concept_thesis_cot",
        "answer": answer,
        "reasoning_context": context,
    }


def dumps_response(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)
