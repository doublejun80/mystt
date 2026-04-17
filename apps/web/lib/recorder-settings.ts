export type PortalTheme = "sand" | "sage" | "sky";

export interface RecorderPreferences {
  theme: PortalTheme;
  enableMixedLanguage: boolean;
  enableSpeakerDiarization: boolean;
  highlightLowConfidence: boolean;
  enableLiveTranslation: boolean;
  endpointDelayMs: number;
  contextTermsText: string;
}

export const defaultRecorderPreferences: RecorderPreferences = {
  theme: "sand",
  enableMixedLanguage: true,
  enableSpeakerDiarization: false,
  highlightLowConfidence: true,
  enableLiveTranslation: false,
  endpointDelayMs: 1500,
  contextTermsText: ""
};

export const endpointDelayOptions = [
  {
    value: 700,
    label: "0.7초",
    description: "빠르게 끊어서 짧은 발화에 반응합니다."
  },
  {
    value: 1200,
    label: "1.2초",
    description: "짧은 회의 응답과 일반 대화에 무난합니다."
  },
  {
    value: 1500,
    label: "1.5초",
    description: "현재 기본값입니다."
  },
  {
    value: 2200,
    label: "2.2초",
    description: "중간에 잠깐 멈추는 화자에게 더 안정적입니다."
  },
  {
    value: 3000,
    label: "3.0초",
    description: "긴 사고 후 이어 말하는 회의에 적합합니다."
  }
] as const;

export const portalThemeOptions: Array<{
  id: PortalTheme;
  label: string;
  description: string;
}> = [
  {
    id: "sand",
    label: "그라파이트",
    description: "중성의 기본 다크 톤"
  },
  {
    id: "sage",
    label: "포레스트",
    description: "차분한 녹색 다크 톤"
  },
  {
    id: "sky",
    label: "인디고",
    description: "차가운 블루 다크 톤"
  }
];
