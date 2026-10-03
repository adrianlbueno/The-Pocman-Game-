import { useEffect, useRef, useState } from "react";
import "./App.css";
import ReactMarkdown from "react-markdown";
// import cumbiaImagA from "./assets/enanito-bailan.gif";
import {
  playSpotify,
  nextSpotifyTrack,
  pauseSpotify,
  resumeSpotify,
  getCurrentSpotifyTrack,
} from "./SpotifyApi";

import { contentString } from "./content";
import { SYSTEM_PROMPT } from "./content";
import type {
  AssistantAction,
  AssistantState,
  Message,
  SpeechRecognitionInstance,
} from "./type";

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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
    console.log("query", query);

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

  const getLocalAction = (text: string): AssistantAction | null => {
    const normalized = text.toLowerCase().trim();

    const nextTrackPatterns = [
      // Direct
      /^(play )?(the )?next (song|track)$/,
      /^next( song| track)?$/,
      /^skip$/,
      /^skip (this|the) (song|track)$/,

      // Change
      /^change (this|the) (song|track)$/,
      /^change (to )?(a )?(new|different|another) (song|track)$/,
      /^play (a )?(new|different|another) (song|track)$/,

      // Don't like it
      /^i (don't|dont|do not) like (this|the) (song|track)$/,
      /^i (don't|dont|do not) like this$/,
      /^i hate (this|the) (song|track)$/,

      // Natural commands
      /^put on something (else|different)$/,
      /^play something (else|different)$/,
      /^give me something (else|different)$/,
      /^another (song|track)$/,
    ];

    if (nextTrackPatterns.some((pattern) => pattern.test(normalized))) {
      return { type: "spotify_next" };
    }

    if (
      normalized === "pause" ||
      normalized === "pause music" ||
      normalized === "pause the music"
    ) {
      return { type: "spotify_pause" };
    }

    if (
      normalized === "resume" ||
      normalized === "resume music" ||
      normalized === "resume the music"
    ) {
      return { type: "spotify_resume" };
    }

    if (
      normalized === "what song is this" ||
      normalized === "what is playing" ||
      normalized === "who is singing this"
    ) {
      return { type: "spotify_current" };
    }

    return null;
  };

  const getAssistantAction = async (
    text: string,
    history: Message[],
  ): Promise<AssistantAction> => {
    const recentHistory = history.slice(-6);

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
            content: contentString,
          },

          ...recentHistory,

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
      await nextSpotifyTrack();

      // Give Spotify a moment to update its playback state
      await new Promise((resolve) => setTimeout(resolve, 500));

      const currentTrack = await getCurrentSpotifyTrack();

      if (!currentTrack.track) {
        await speak("I couldn't find the current track.");
        return;
      }

      const announcement = `Now playing ${currentTrack.track} by ${currentTrack.artist}.`;

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: announcement,
        },
      ]);

      await speak(announcement);
    } catch (error) {
      console.error("Spotify next error:", error);
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const trimmedInput = (textOverride ?? input).trim();

    if (!trimmedInput || loading) {
      return;
    }

    const localAction = getLocalAction(trimmedInput);

    const action =
      localAction ?? (await getAssistantAction(trimmedInput, messages));

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
      case "spotify_keep":
        return;
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
          <div className={`assistantStatus ${assistantState}`}>
            {assistantState === "idle" && "Ready"}
            {assistantState === "listening" && "Listening..."}
            {assistantState === "thinking" && "Thinking..."}
            {assistantState === "speaking" && "Speaking..."}
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
              {/* <img src={cumbiaImagA} alt="Cumbiaaaa" /> */}
              <ReactMarkdown>message.content</ReactMarkdown>
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
