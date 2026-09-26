import { useEffect, useRef, useState } from "react";
import "./App.css";
import ReactMarkdown from "react-markdown";
import {
  playSpotify,
  nextSpotifyTrack,
  pauseSpotify,
  resumeSpotify,
  getCurrentSpotifyTrack,
} from "./Spotify";
type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type AssistantAction =
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
      type: "chat";
    }
  | {
      type: "spotify_current";
    };

type SpeechRecognitionEvent = Event & {
  results: {
    length: number;

    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
};

type AssistantState = "idle" | "listening" | "thinking" | "speaking";

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
  }
}

const SYSTEM_PROMPT = `
You are a helpful local AI assistant.

Be concise.
Be natural.
Explain technical topics clearly.
When reviewing code, behave like a senior frontend developer.
`;

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const KOKORO_VOICES = [
    { id: "af_heart", label: "Heart" },
    { id: "af_bella", label: "Bella" },
    { id: "af_nicole", label: "Nicole" },
    { id: "af_sarah", label: "Sarah" },
    { id: "am_adam", label: "Adam" },
    { id: "am_michael", label: "Michael" },
  ];

  const [selectedVoice, setSelectedVoice] = useState("af_heart");
  const [speakAutomatically, setSpeakAutomatically] = useState(true);

  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const [assistantState, setAssistantState] = useState<AssistantState>("idle");

  const [conversationMode, setConversationMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const WAKE_WORD = "YOOO";

  const [wakeWordMode, setWakeWordMode] = useState(false);

  const assistantStateRef = useRef<AssistantState>("idle");

  const wakeWordModeRef = useRef(false);

  const conversationModeRef = useRef(false);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  // const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speak = async (text: string): Promise<void> => {
    if (!text.trim()) {
      return;
    }
    stopSpeaking();

    try {
      const response = await fetch("http://localhost:8001/speak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      audioUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);

      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onplay = () => {
          setAssistantState("speaking");
        };

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);

          if (audioUrlRef.current === audioUrl) {
            audioUrlRef.current = null;
          }

          if (audioRef.current === audio) {
            audioRef.current = null;
          }

          setAssistantState("idle");

          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);

          setAssistantState("idle");

          reject(new Error("Kokoro audio playback error"));
        };

        audio.play().catch(reject);
      });
    } catch (error) {
      console.error("Kokoro TTS error:", error);
    }
  };

  // const startListening = () => {
  //   if (!recognitionRef.current) {
  //     alert("Speech recognition is not supported in this browser.");
  //     return;
  //   }

  //   setIsListening(true);
  //   setAssistantState("listening");
  //   recognitionRef.current.start();
  // };

  const handleSpotifyPlay = async (query: string) => {
    await pauseSpotify();

    const announcement = `Sure, I'm looking for ${query}.`;

    await speak(announcement);

    const result = await playSpotify(query);

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: `Playing ${result.track} by ${result.artist}.`,
      },
    ]);
  };

  // const handleSpotifyNext = async () => {
  //   await pauseSpotify();

  //   const announcement = "Okay, I'll find you another one.";

  //   await speak(announcement);

  //   await nextSpotifyTrack();

  //   await resumeSpotify();
  // };

  const getAssistantAction = async (text: string): Promise<AssistantAction> => {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3.2",
        stream: false,
        format: "json",

        messages: [
          {
            role: "system",
            content: `
You are an intent classifier for a general-purpose voice assistant.

Your job is ONLY to determine whether the user explicitly wants to control Spotify.

Available actions:

spotify_play
spotify_next
spotify_pause
spotify_resume
spotify_current
chat

IMPORTANT RULE:

If the user is NOT clearly asking to control or identify Spotify music,
you MUST return:

{
  "type": "chat"
}

Do NOT assume that ordinary conversation is about music.

Examples:

User: "How are you?"
{
  "type": "chat"
}

User: "Tell me about Ecuador"
{
  "type": "chat"
}

User: "What should I eat tonight?"
{
  "type": "chat"
}

User: "Can you help me with React?"
{
  "type": "chat"
}

User: "I had a difficult day"
{
  "type": "chat"
}

User: "play Bad Bunny"
{
  "type": "spotify_play",
  "query": "Bad Bunny"
}

User: "put on some bachata"
{
  "type": "spotify_play",
  "query": "bachata"
}

User: "I want to listen to Romeo Santos"
{
  "type": "spotify_play",
  "query": "Romeo Santos"
}

User: "skip this song"
{
  "type": "spotify_next"
}

User: "I don't like this track"
{
  "type": "spotify_next"
}

User: "pause the music"
{
  "type": "spotify_pause"
}

User: "resume the music"
{
  "type": "spotify_resume"
}

User: "what song is this?"
{
  "type": "spotify_current"
}

User: "who is singing this?"
{
  "type": "spotify_current"
}

Return ONLY valid JSON.
Do not answer the user's question.
Do not perform the action.
`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Intent request failed: ${response.status}`);
    }

    const data = await response.json();

    return JSON.parse(data.message.content) as AssistantAction;
  };

  const handleSpotifyNext = async () => {
    try {
      await pauseSpotify();

      const announcement = "Okay, I'll find you another one.";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: announcement,
        },
      ]);

      await speak(announcement);

      await nextSpotifyTrack();

      await resumeSpotify();
    } catch (error) {
      console.error("Spotify next error:", error);
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const trimmedInput = (textOverride ?? input).trim();

    if (!trimmedInput || loading) {
      return;
    }

    const action = await getAssistantAction(trimmedInput);

    console.log("action", action);

    switch (action.type) {
      case "spotify_play":
        await handleSpotifyPlay(action.query);

        return;

      case "spotify_next":
        await handleSpotifyNext();

        return;

      case "spotify_pause":
        await pauseSpotify();

        await speak("Okay, music paused.");

        return;

      case "spotify_resume":
        await speak("Sure.");

        await resumeSpotify();

        return;

      case "spotify_current": {
        const currentTrack = await getCurrentSpotifyTrack();

        console.log("Current Spotify track:", currentTrack);

        if (!currentTrack.track) {
          const responseText = "Nothing is playing right now.";

          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content: responseText,
            },
          ]);

          await speak(responseText);

          return;
        }

        const responseText = `This is ${currentTrack.track} by ${currentTrack.artist}.`;

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: responseText,
          },
        ]);

        await speak(responseText);

        return;
      }

      case "chat":
        break;
    }

    const nextMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: trimmedInput,
      },
    ];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setAssistantState("thinking");

    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3.2",
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            ...nextMessages,
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();

      let assistantContent = "";

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: "",
        },
      ]);

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, {
          stream: true,
        });

        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          const data = JSON.parse(line);

          if (data.message?.content) {
            assistantContent += data.message.content;

            setMessages([
              ...nextMessages,
              {
                role: "assistant",
                content: assistantContent,
              },
            ]);
          }
        }
      }

      if (speakAutomatically) {
        speak(assistantContent);
      }
    } catch (error) {
      console.error(error);

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            "I couldn't connect to Ollama. Make sure `ollama serve` is running.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript
        .trim()
        .toLowerCase();

      console.log("transcript", transcript);

      console.log("Heard:", transcript);

      if (wakeWordModeRef.current) {
        const wakeWordIndex = transcript.indexOf(WAKE_WORD);

        if (wakeWordIndex === -1) {
          return;
        }

        const command = transcript
          .slice(wakeWordIndex + WAKE_WORD.length)
          .trim();

        console.log("Wake word detected");

        if (command) {
          sendMessage(command);
        } else {
          setAssistantState("listening");
        }

        return;
      }

      setInput(transcript);

      if (conversationModeRef.current) {
        sendMessage(transcript);
      }
    };

    recognition.onend = () => {
      setIsListening(false);

      if (
        wakeWordModeRef.current &&
        assistantStateRef.current !== "speaking" &&
        assistantStateRef.current !== "thinking"
      ) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // recognition may already be running
          }
        }, 300);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  const startWakeWordMode = () => {
    if (!recognitionRef.current) {
      return;
    }

    setWakeWordMode(true);

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      // already listening
    }
  };

  const stopWakeWordMode = () => {
    setWakeWordMode(false);

    recognitionRef.current?.stop();

    setIsListening(false);
    setAssistantState("idle");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  useEffect(() => {
    wakeWordModeRef.current = wakeWordMode;
  }, [wakeWordMode]);

  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);

  useEffect(() => {
    assistantStateRef.current = assistantState;
  }, [assistantState]);

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">AI</div>

          <div className={`assistantStatus ${assistantState}`}>
            {assistantState === "idle" && "Ready"}
            {assistantState === "listening" && "Listening..."}
            {assistantState === "thinking" && "Thinking..."}
            {assistantState === "speaking" && "Speaking..."}
          </div>

          <div>
            {/* <h1>Local AI</h1> */}
            {/* <p>llama3.2 · Kokoro</p> */}
          </div>
        </div>

        <div className="voiceControls">
          <label className="control">
            <span>Voice</span>

            <select
              value={selectedVoice}
              onChange={(event) => setSelectedVoice(event.target.value)}
            >
              {KOKORO_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </label>

          {/* <label className="control speedControl">
            <span>Speed {speechRate.toFixed(1)}x</span>

            <input

              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speechRate}
              onChange={(event) => setSpeechRate(Number(event.target.value))}
            />
          </label> */}

          <label>
            <input
              type="checkbox"
              checked={wakeWordMode}
              onChange={(event) => {
                if (event.target.checked) {
                  startWakeWordMode();
                } else {
                  stopWakeWordMode();
                }
              }}
            />
            Wake word
          </label>

          <label className="autoSpeak">
            <input
              type="checkbox"
              checked={conversationMode}
              onChange={(event) => setConversationMode(event.target.checked)}
            />

            <span>Conversation mode</span>
          </label>

          <label className="autoSpeak">
            <input
              type="checkbox"
              checked={speakAutomatically}
              onChange={(event) => setSpeakAutomatically(event.target.checked)}
            />

            <span>Auto voice</span>
          </label>
        </div>
      </header>

      <section className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <div className="emptyIcon">✦</div>

            <h2>What can I help with?</h2>

            <p>Chat with your local AI or use your microphone.</p>
          </div>
        )}

        {messages.map((message, index) => (
          <article key={index} className={`chatMessage ${message.role}`}>
            <div className="messageHeader">
              <span className="messageAuthor">
                {message.role === "user" ? "You" : "Local AI"}
              </span>

              {message.role === "assistant" && (
                <button
                  className="messageAction"
                  onClick={() => speak(message.content)}
                  title="Read aloud"
                >
                  🔊
                </button>
              )}
            </div>

            <div className="messageContent">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </article>
        ))}

        {loading && (
          <div className="thinking">
            <span />
            <span />
            <span />
          </div>
        )}

        <div ref={messagesEndRef} />
      </section>

      <div className="composerWrapper">
        <section className="composer">
          {/* <button
            className={`composerButton mic ${isListening ? "active" : ""}`}
            onClick={startListening}
            disabled={isListening}
            title="Speak"
          >
            {isListening ? "●" : "🎤"}
          </button> */}

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : "Message Local AI..."}
            rows={1}
          />

          <button
            className="composerButton"
            onClick={stopSpeaking}
            title="Stop audio"
          >
            ■
          </button>

          <button
            className="sendButton"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            title="Send"
          >
            CHAT
          </button>
        </section>
        {/* 
        <span className="composerHint">
          Enter to send · Shift + Enter for a new line
        </span> */}
      </div>
    </main>
  );
}
