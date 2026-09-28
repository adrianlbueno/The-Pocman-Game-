export type AssistantAction =
  | {
      type: "spotify_play";
      query: string;
    }
  | {
      type: "spotify_next";
    }
  | {
      type: "spotify_pause";
    }
  | {
      type: "spotify_resume";
    }
  | {
      type: "spotify_current";
    }
  | {
      type: "spotify_keep";
    }
  | {
      type: "chat";
    };

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SpeechRecognitionEvent = Event & {
  results: {
    length: number;

    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};

export type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
};

export type AssistantState = "idle" | "listening" | "thinking" | "speaking";
