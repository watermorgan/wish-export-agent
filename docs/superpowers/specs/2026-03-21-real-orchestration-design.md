# Design Spec: Real LLM Orchestration (Sequential & Accumulative)

## 1. Overview
The project currently relies on mock data in `execution.ts`. This spec defines the transition to a real LLM orchestration engine that executes skills sequentially (Option B) and accumulates context across steps (Mode 1). We will start with the "Feedback/Translation" scenario as the primary implementation target.

## 2. Core Concepts

### 2.1 Sequential Step Runner
Instead of a single LLM call, the orchestrator will iterate through `selectedSkillIds`. Each skill execution is an independent LLM interaction that contributes to the final result.

### 2.2 Accumulative Context (Mode 1)
Each step receives a `CumulativeContext` object which grows as the chain progresses.
- **Initial Context**: Uploaded file content + user question.
- **Step N Context**: Initial Context + Outputs from Steps 1 to N-1.

### 2.3 Structural Output & Parsing
The LLM will be instructed to provide a structured Markdown or JSON-like response. The orchestrator will parse this into:
- `ArtifactSection`: Structured data for the UI.
- `PendingConfirmation`: Risk items tagged with `[PENDING_CONFIRMATION]` in the LLM response.
- `ExecutionPlanStep`: Status updates for the timeline.

## 3. Implementation Logic

### 3.1 Orchestrator Flow (`runAssistant`)
1.  **Preparation**: Infer `taskType` and load `selectedSkills`.
2.  **Extraction**: Extract text from `UploadedFile` objects.
3.  **Iteration**: For each `skill`:
    - Load `prompt.md` using `prompt-loader.ts`.
    - Construct Prompt: `System Prompt (Skill) + User Prompt (Cumulative Context)`.
    - Call LLM via `llm/router.ts`.
    - Parse Step Result: Extract table/list data and risk markers.
    - Append to `CumulativeContext`.
4.  **Finalization**: Assemble `AssistantReply` using the accumulated artifacts and audit trail.

### 3.2 Parsing Strategy
- Use regex or JSON schema parsing to extract fields from LLM output.
- Specifically look for the `[PENDING_CONFIRMATION]` tag to automatically generate `required` confirmation items.

## 4. Scenario Focus: Feedback & Translation
The first fully implemented chain will be:
`comment-translator` -> `comment-merger` -> `customer-reply-drafter`.

## 5. Success Criteria
- The "Feedback Analysis" task no longer returns "重点意见 A" fixture text.
- The UI displays real translations and real merged themes based on uploaded documents.
- Risks like "Price" or "Delivery" are correctly identified and moved to the "Pending Confirmations" panel.
