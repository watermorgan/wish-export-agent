export type ModelOption = {
  id: string;
  label: string;
  description: string;
};

const localModelId =
  process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL_NAME ?? 'Gemma-4-31B-it';
const localModelLabel =
  process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL_LABEL ?? 'Gemma 4 31B Local';

export const visionModelOptions: ModelOption[] = [
  {
    id: localModelId,
    label: localModelLabel,
    description: '本地 OpenAI-compatible 模型，默认联调入口，优先用于视觉/OCR 低成本联调。'
  },
  {
    id: 'Qwen/Qwen3.5-35B-A3B',
    label: 'Qwen 3.5 35B A3B',
    description: 'ModelScope 在线视觉/OCR 模型，当前用于替代额度受限的 Kimi K2.5。'
  },
  {
    id: 'moonshotai/Kimi-K2.5',
    label: 'Kimi K2.5',
    description: '视觉/OCR辅助识别，适合图片与低置信区域补强。'
  }
];

export const translationModelOptions: ModelOption[] = [
  {
    id: localModelId,
    label: localModelLabel,
    description: '本地 OpenAI-compatible 模型，A/B 联调默认入口，优先用于节省线上 token。'
  },
  {
    id: 'qwen3.5-27b',
    label: 'Qwen 3.5 27B',
    description: '百炼 compatible-mode 翻译模型，当前可返回标准 chat.completions 内容。'
  },
  {
    id: 'Qwen/Qwen3.5-397B-A17B',
    label: 'Qwen 3.5 397B A17B',
    description: 'ModelScope 在线翻译模型，作为结构化翻译兜底。'
  },
  {
    id: localModelId,
    label: localModelLabel,
    description: '本地 OpenAI-compatible 模型，A/B 联调优先，节省线上 token。'
  },
  {
    id: 'qwen3.5-flash',
    label: 'Qwen 3.5 Flash',
    description: '当前 DashScope 翻译模型，用于页面与单文件验证。'
  },
  {
    id: 'MiniMax/MiniMax-M2.1',
    label: 'MiniMax M2.1',
    description: 'Qwen 额度不足时的替补翻译模型，优先走 ModelScope。'
  }
];

export const defaultVisionModelId = localModelId;
export const defaultTranslationModelId = localModelId;
