---
name: explain-logic
description: Explains the business logic of a solution as a concise numbered list — what the system does, not how it's implemented. Use when user asks to explain logic, describe how something works, summarize a solution, or says "wytłumacz logikę", "jak to działa", "opisz rozwiązanie".
---

# Explain Logic

Read the relevant code, then produce a **numbered list** describing the business logic.

## Rules

- Each point = one short sentence
- Business perspective only — no file names, line numbers, variable names, or implementation details
- Describe WHAT happens and WHY, not HOW
- Order points by flow (start → end)
- Max 6 points; merge minor steps
- Write in the same language the user used

## What to omit

- Framework/library names unless central to the concept (e.g. "uses OpenAI vision model" is OK, "calls `vision.chat.completions.create`" is not)
- Error handling internals
- Data types, schemas, variable names

## Example output

Given a drone mission agent:

1. Agent równolegle pobiera dokumentację drona i analizuje mapę terenu.
2. Analiza mapy używa VLM do zidentyfikowania układu siatki i lokalizacji tamy.
3. Structured output wymusza na VLM zwrot ustrukturyzowanego JSON z lokalizacją tamy.
4. Na podstawie dokumentacji i współrzędnych agent wysyła instrukcje lotu do endpointu weryfikacji i iteracyjnie poprawia je na podstawie zwracanych błędów.
