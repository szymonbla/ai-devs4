# E05 — Agent z tool use eksplorujący nieznane API

## Po co to jest?

Uczysz się budować **agenta, któTry samodzielnie odkrywa i obsługuje nieznane API**. o kluczowa umiejętność — w praktyce często dajesz LLM-owi narzędzia i pozwalasz mu samemu wymyślić, jak ich użyć, zamiast hardcodować sekwencję kroków.

Główna lekcja: **nie musisz znać API z góry**. Wystarczy dać modelowi jedno narzędzie + instrukcję "zacznij od help" i pozwolić mu działać.

## Jak to działa krok po kroku

### 1. Przygotowanie kontekstu (index.ts)

Agent dostaje system prompt z celem ("aktywuj trasę X-01") i jedną wskazówką ("zacznij od help"). Nie dostaje dokumentacji API — ma ją odkryć sam.

### 2. Pętla agentowa (index.ts, linie 24–64)

```
powtarzaj (max 25 razy):
  1. Wyślij historię konwersacji do LLM
  2. LLM decyduje: wywołać narzędzie czy odpowiedzieć tekstem
  3. Jeśli brak tool_calls → koniec, wypisz odpowiedź
  4. Jeśli są tool_calls → wykonaj je, dopisz wyniki do historii
```

To jest **standardowy wzorzec agentic loop** — model sam decyduje co robić i kiedy skończyć. Ty dostarczasz tylko narzędzia i cel.

### 3. Narzędzie: call_railway_api (tools.ts)

Jedno uniwersalne narzędzie z parametrami `action`, `route`, `value`. Model sam odkrywa jakie akcje są dostępne (przez `action=help`) i w jakiej kolejności je wywołać.

Typowy przebieg wywołań modelu:
1. `help` → odkryj dostępne akcje
2. `getstatus` → sprawdź stan trasy
3. `setstatus` → zmień stan
4. `save` → zapisz zmiany

### 4. Retry i rate limiting (tools.ts, linie 32–79)

API REDACTED_DOMAIN bywa niestabilne. `callWithRetry` obsługuje:
- **503** — serwer niedostępny, exponential backoff
- **Rate limit** — za dużo requestów, czekaj na reset
- **Retry-After header** — serwer mówi ile czekać

To ważne w produkcji — zewnętrzne API padają, trzeba to obsłużyć.

## Kluczowe koncepty do zapamiętania

| Koncept | Gdzie w kodzie | Po co |
|---|---|---|
| **Agentic loop** | `index.ts:24` | Model sam decyduje ile kroków potrzebuje |
| **Tool use** | `tools` array + `handlers` | Dajesz modelowi zdolności, nie instrukcje |
| **API discovery** | system prompt: "start with help" | Model eksploruje API jak człowiek |
| **Retry z backoff** | `callWithRetry()` | Odporność na niestabilne API |
| **Konwersacja jako pamięć** | `messages.push(msg, ...results)` | Cała historia leci do modelu — pamięta co już zrobił |

## Jak to uruchomić

```bash
pnpm install
pnpm start
```

Wymagane zmienne w `.env`:
- `OPENROUTER_API_KEY` — klucz do OpenRouter
- `AG3NTS_API_KEY` — klucz do REDACTED_DOMAIN

## Struktura plików

```
src/
  index.ts      — pętla agentowa, komunikacja z LLM
  tools.ts      — definicja narzędzia + handler wywołujący API
  constants.ts  — nazwa zadania i model
  env.ts        — ładowanie .env
```
