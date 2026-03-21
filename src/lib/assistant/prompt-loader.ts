import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PromptLoader is responsible for reading the markdown prompts for specific skills.
 * This is a utility function meant to be used by the Core Agent Orchestrator during
 * real model execution, ensuring we don't leak `fs` operations into client-side code.
 */

// We assume the project root is the current working directory.
// In a Next.js API route, process.cwd() points to the project root.
const SKILLS_DIR = join(process.cwd(), 'src', 'skills');

export function loadSkillPrompt(skillId: string): string | null {
  try {
    const promptPath = join(SKILLS_DIR, skillId, 'prompt.md');
    // Using readFileSync because this is intended to be loaded once and cached,
    // or loaded dynamically during an async API route execution where blocking
    // the event loop for a single small file read is acceptable.
    return readFileSync(promptPath, 'utf-8');
  } catch (err) {
    // Return null if the prompt file doesn't exist or cannot be read.
    // This allows the orchestrator to fallback to a default prompt or throw a specific error.
    console.warn(`Failed to load prompt for skill ${skillId}:`, err);
    return null;
  }
}
