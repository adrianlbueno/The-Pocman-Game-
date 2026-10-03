type SpotifyProps = {
  playing: boolean;
  track: string;
  artist: string;
  uri: string;
  device: string;
};

export const playSpotify = async (query: string): Promise<SpotifyProps> => {
  const response = await fetch("http://127.0.0.1:8001/spotify/play", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
    }),
  });

  if (!response.ok) {
    const error = await response.text();

    throw new Error(`Spotify request failed: ${response.status} ${error}`);
  }

  return response.json();
};

export const nextSpotifyTrack = async () => {
  const response = await fetch("http://127.0.0.1:8001/spotify/next", {
    method: "POST",
  });

  console.log("response", response);

  if (!response.ok) {
    const error = await response.text();

    throw new Error(`Spotify next failed: ${response.status} ${error}`);
  }

  return response.json();
};

export const pauseSpotify = async () => {
  const response = await fetch("http://127.0.0.1:8001/spotify/pause", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Spotify pause failed: ${response.status}`);
  }

  return response.json();
};

export const resumeSpotify = async () => {
  const response = await fetch("http://127.0.0.1:8001/spotify/resume", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Spotify resume failed: ${response.status}`);
  }

  return response.json();
};

type SpotifyCurrentTrackResult = {
  playing: boolean;
  track: string | null;
  artist: string | null;
  uri: string | null;
};

export const getCurrentSpotifyTrack =
  async (): Promise<SpotifyCurrentTrackResult> => {
    const response = await fetch("http://127.0.0.1:8001/spotify/current");

    if (!response.ok) {
      const error = await response.text();

      throw new Error(
        `Spotify current track failed: ${response.status} ${error}`,
      );
    }

    return response.json();
  };
