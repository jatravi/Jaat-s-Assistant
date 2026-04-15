"""
Jaat's Assistant — FastAPI Backend
Processes quiz questions using Google Gemini 1.5 Flash
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai

# ===== Configuration =====
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

if not GEMINI_API_KEY:
    print("\n[WARNING] GEMINI_API_KEY environment variable is not set!")
    print("   Set it before starting the server:")
    print("     Linux/macOS : export GEMINI_API_KEY='your-api-key-here'")
    print("     Windows CMD : set GEMINI_API_KEY=your-api-key-here")
    print("     PowerShell  : $env:GEMINI_API_KEY = 'your-api-key-here'\n")

client = genai.Client(api_key=GEMINI_API_KEY)

MODEL_ID = "gemini-1.5-flash"

# ===== FastAPI App =====
app = FastAPI(
    title="Jaat's Assistant API",
    description="AI-powered quiz solver backend using Gemini 1.5 Flash",
    version="1.0.0"
)

# CORS — allow Chrome extension and local development requests.
# Chrome extensions use chrome-extension:// origins; localhost is for dev/testing.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Models =====
class SolveRequest(BaseModel):
    question: str
    options: list[str] = []

class SolveResponse(BaseModel):
    answer: str
    explanation: str

# ===== Endpoints =====
@app.get("/")
async def root():
    """Root endpoint — confirms the server is running."""
    return {
        "name": "Jaat's Assistant API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "GET /": "This page",
            "GET /health": "Health check",
            "POST /solve": "Solve a quiz question"
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint for the side panel status indicator."""
    return {"status": "ok", "model": MODEL_ID}

@app.post("/solve", response_model=SolveResponse)
async def solve_question(req: SolveRequest):
    """
    Solve a quiz question using Gemini 1.5 Flash.
    Accepts a question with optional multiple-choice options.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not configured. Set the environment variable and restart the server."
        )

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    # Build the prompt
    prompt = build_prompt(req.question, req.options)

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt
        )
        text = response.text.strip()

        # Parse the response into answer + explanation
        answer, explanation = parse_response(text, req.options)

        return SolveResponse(answer=answer, explanation=explanation)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


def build_prompt(question: str, options: list[str]) -> str:
    """Build an optimized prompt for the Gemini model."""
    if options:
        options_text = "\n".join(f"  {opt}" for opt in options)
        return f"""You are an expert quiz solver. Answer the following multiple-choice question.

Question: {question}

Options:
{options_text}

Instructions:
1. First line: State ONLY the correct answer (e.g., "A) Answer text" or just the answer text).
2. Then leave a blank line.
3. Then provide a clear, concise explanation of why this is the correct answer.

Be accurate and concise."""
    else:
        return f"""You are an expert quiz solver. Answer the following question accurately and concisely.

Question: {question}

Instructions:
1. First line: Provide a clear, direct answer.
2. Then leave a blank line.
3. Then provide a brief explanation or supporting details.

Be accurate and concise."""


def parse_response(text: str, options: list[str]) -> tuple[str, str]:
    """Parse Gemini's response into answer and explanation parts."""
    parts = text.split("\n\n", 1)

    answer = parts[0].strip()
    explanation = parts[1].strip() if len(parts) > 1 else ""

    return answer, explanation


# ===== Run =====
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
