---
title: "Week 2: Hands-on Prompting for Coding"
source: "docs/pdf/slides/week_2/hands-on-coding-with-AI-prompting-1.pdf"
pages: 10
converted_by: "Docling v2"
---

# Week 2: Hands-on Prompting for Coding

> **Source**: `docs/pdf/slides/week_2/hands-on-coding-with-AI-prompting-1.pdf` | **Pages**: 10
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Coding with AI

## Practical session

Prof. Dr. Guido Salvaneschi

From insight to impact.

## Coding with Al

## A Programmer's Sketchbook Across the Development Workflow

To access this content, you can

- Clone this repository to play with the Jupyter notebooks
- Browse the markdown version of the book

<!-- image -->

https://github.com/prg-grp/coding-with-ai

2

## Jupyter Notebooks

<!-- image -->

## Running Jupyter Notebooks

Load the notebook in google

drive and open it VScode can also execute

a notebook

<!-- image -->

https://github.com/prg-grp/coding-with-ai

<!-- image -->

5

## The exercise

<!-- image -->

## Your task: solve the exercises with LLMs of different power

Work through the exercises in the notebook, but do not just pick one model: solve each exercise with at least three

- One small model, one mid-size model, one frontier model
- Use exactly the same prompt for every model, so the comparison is fair

## Run the generated code and check whether it actually works

- Do not fix the code yourself: if it fails, tell the model what went wrong and let it retry

Goal: the exercises are the vehicle, the real goal is to get a feeling for what models of different size and power can and cannot do

<!-- image -->

7

## Pick one model from each tier (all free on OpenRouter)

Small: LFM 2.5 2.6B (Liquid), Laguna XS 2.1 (Poolside), Gemma 4 26B-A4B (Google)

- Fast and free. Expect wrong or incomplete code on anything non-trivial

Mid-size: Gemma 4 31B (Google), Nemotron 3 Super 120B (NVIDIA), GLM 5.2 (Z.ai)

- Decent everyday coding assistants, still free

Frontier: Nemotron 3 Ultra 550B (NVIDIA, free), or paid: Claude Opus 4.8, DeepSeek V4 Pro, GPT-5.6

- Strongest reasoning, slower; paid ones cost a few cents per exercise

How to find them: openrouter.ai/models, filter "Free"; free IDs end in :free

Note: the free list changes monthly, check it the day before the lab (status: September 2026)

<!-- image -->

8

## Tools: nothing to install, just a browser

OpenRouter (openrouter.ai): chat with models from all providers in one place

- Create an account, open the chat, switch the model in the dropdown, paste the same prompt
- Free models: 50 requests per day without credits, 1,000 per day after a one-time $10 top-up
- Plan your prompts: three models times a handful of exercises fits the free limit

Google Colab: run the generated Python code, same notebook as for the exercises

- Paste the code into a cell, execute, copy any error back to the model

Alternatives: Google AI Studio (Gemini models only), Hugging Face Spaces (find a demo of your model) s

Optional, for the curious: Ollama runs small models locally on your laptop, but needs installation

<!-- image -->

9

## What to observe, and what to bring back to the group

## For every exercise and model, note:

- Did the code run on the first try? How many retries were needed?
- Is the result actually correct, or does it only look correct?
- Did the model understand the task, or solve a slightly different one?
- Response time and cost (OpenRouter shows both)

## Discussion questions:

- Where exactly does the small model break down, and does the mid-size model fix that?
- When is the frontier model worth its price, and when is it overkill?

<!-- image -->

University of St.Gallen
