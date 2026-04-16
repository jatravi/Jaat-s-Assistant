# Jaat's Assistant

AI-powered Chrome extension that scrapes quiz questions from web pages and provides intelligent answers using Google Gemini AI.

## Features

- **Page Scanner** — Automatically detects quiz questions and answer options from any web page
- **Multi-Strategy Scraping** — Handles standard HTML forms, ARIA roles, framework components (Angular Material, MUI), and plain-text quizzes
- **Iframe Support** — Scrapes questions inside iframes (e.g., Cisco NetAcad, Canvas, Blackboard)
- **AI-Powered Answers** — Sends detected questions to Google Gemini 1.5 Flash for accurate, explained answers
- **Side Panel UI** — Clean, modern interface that opens in Chrome's side panel without disrupting your workflow
- **Real-Time Status** — Live backend connection indicator and loading states

## Architecture

```
extension/          Chrome Extension (Manifest V3)
├── manifest.json       Extension configuration
├── background.js       Service worker — side panel lifecycle & message routing
├── content.js          Content script — multi-strategy question scraper
├── sidepanel.html      Side panel markup
├── sidepanel.js        Side panel logic — scraping triggers & backend communication
├── sidepanel.css       Side panel styles (dark indigo/violet theme)
└── icons/              Extension icons (16, 48, 128px)

backend/            FastAPI Backend
├── main.py             API server — processes questions via Gemini 1.5 Flash
└── requirements.txt    Python dependencies

test/               Test Fixtures
└── quiz.html           Sample quiz page for manual testing
```

## Prerequisites

- **Python 3.10+**
- **Google Chrome** (or a Chromium-based browser)
- **Google Gemini API key** — get one at [Google AI Studio](https://aistudio.google.com/apikey)

## Getting Started

### 1. Start the Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Set your Gemini API key
export GEMINI_API_KEY='your-api-key-here'   # Linux / macOS
# set GEMINI_API_KEY=your-api-key-here      # Windows CMD
# $env:GEMINI_API_KEY = 'your-api-key-here' # PowerShell

# Run the server
python main.py
```

The API server starts at **http://localhost:8000**. Verify it's running:

```bash
curl http://localhost:8000/health
# {"status":"ok","model":"gemini-1.5-flash"}
```

### 2. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `extension/` folder
4. The Jaat's Assistant icon appears in your toolbar

### 3. Use It

1. Navigate to any page with quiz questions
2. Click the extension icon to open the side panel
3. Click **Scan Page** to detect questions
4. Click **Solve** on any detected question to get an AI-generated answer with explanation

## API Endpoints

| Method | Path      | Description                        |
|--------|-----------|------------------------------------|
| GET    | `/`       | Server info and available endpoints|
| GET    | `/health` | Health check (used by the extension)|
| POST   | `/solve`  | Solve a quiz question              |

### POST `/solve`

**Request:**

```json
{
  "question": "What is the capital of France?",
  "options": ["A) London", "B) Berlin", "C) Paris", "D) Madrid"]
}
```

**Response:**

```json
{
  "answer": "C) Paris",
  "explanation": "Paris is the capital and largest city of France, located on the Seine River."
}
```

## Testing

Open `test/quiz.html` in Chrome to try the extension against a sample quiz page with both standard HTML radio-button questions and ARIA-based (NetAcad-style) questions.

## Tech Stack

- **Extension** — Chrome Manifest V3, vanilla JavaScript, CSS custom properties
- **Backend** — Python, FastAPI, Uvicorn, Google GenAI SDK
- **AI Model** — Gemini 1.5 Flash

## License

This project is provided as-is for educational purposes.
