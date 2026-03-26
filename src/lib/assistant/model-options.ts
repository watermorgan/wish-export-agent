export type ModelOption = {
  id: string;
  label: string;
  description: string;
};

export const visionModelOptions: ModelOption[] = [
  {
    id: 'moonshotai/Kimi-K2.5',
    label: 'Kimi K2.5',
    description: '视觉/OCR辅助识别，适合图片与低置信区域补强。'
  }
];

export const translationModelOptions: ModelOption[] = [
  {
    id: 'qwen3.5-flash',
    label: 'Qwen 3.5 Flash',
    description: '当前 DashScope 翻译模型，用于页面与单文件验证。'
  }
];

export const defaultVisionModelId = visionModelOptions[0]?.id ?? '';
export const defaultTranslationModelId = translationModelOptions[0]?.id ?? '';
