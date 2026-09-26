import base64
import io
import json
import os
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import requests
import soundfile as sf

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from kokoro import KPipeline
from pydantic import BaseModel


# --------------------------------------------------
# Environment
# --------------------------------------------------

load_dotenv()

SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI")

TOKEN_FILE = Path("spotify_tokens.json")


# --------------------------------------------------
# FastAPI
# --------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Kokoro
# --------------------------------------------------

pipeline = KPipeline(lang_code="a")


class SpeakRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@app.post("/speak")
def speak(request: SpeakRequest):
    audio_chunks = []

    generator = pipeline(
        request.text,
        voice=request.voice,
        speed=request.speed,
    )

    for _, _, audio in generator:
        audio_chunks.append(audio)

    if not audio_chunks:
        raise HTTPException(
            status_code=500,
            detail="Kokoro did not generate audio.",
        )

    audio = np.concatenate(audio_chunks)

    buffer = io.BytesIO()

    sf.write(
        buffer,
        audio,
        24000,
        format="WAV",
    )

    buffer.seek(0)

    return Response(
        content=buffer.read(),
        media_type="audio/wav",
    )


# --------------------------------------------------
# Spotify Models
# --------------------------------------------------

class SpotifyPlayRequest(BaseModel):
    query: str


# --------------------------------------------------
# Spotify Token Storage
# --------------------------------------------------

spotify_tokens = {
    "access_token": None,
    "refresh_token": None,
}


def save_spotify_tokens():
    TOKEN_FILE.write_text(
        json.dumps(spotify_tokens),
        encoding="utf-8",
    )


def load_spotify_tokens():
    if not TOKEN_FILE.exists():
        return

    try:
        data = json.loads(
            TOKEN_FILE.read_text(
                encoding="utf-8",
            )
        )

        spotify_tokens["access_token"] = (
            data.get("access_token")
        )

        spotify_tokens["refresh_token"] = (
            data.get("refresh_token")
        )

    except Exception as error:
        print(
            "Could not load Spotify tokens:",
            error,
        )


load_spotify_tokens()


# --------------------------------------------------
# Spotify Helpers
# --------------------------------------------------

def get_basic_auth_header():
    if not SPOTIFY_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="SPOTIFY_CLIENT_ID is missing.",
        )

    if not SPOTIFY_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="SPOTIFY_CLIENT_SECRET is missing.",
        )

    auth_string = (
        f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}"
    )

    auth_base64 = base64.b64encode(
        auth_string.encode("utf-8")
    ).decode("utf-8")

    return {
        "Authorization": f"Basic {auth_base64}",
        "Content-Type":
            "application/x-www-form-urlencoded",
    }


def refresh_spotify_access_token():
    refresh_token = spotify_tokens.get(
        "refresh_token"
    )

    if not refresh_token:
        raise HTTPException(
            status_code=401,
            detail=(
                "Spotify is not connected. "
                "Open /spotify/login first."
            ),
        )

    response = requests.post(
        "https://accounts.spotify.com/api/token",
        headers=get_basic_auth_header(),
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=15,
    )

    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    data = response.json()

    spotify_tokens["access_token"] = (
        data["access_token"]
    )

    if data.get("refresh_token"):
        spotify_tokens["refresh_token"] = (
            data["refresh_token"]
        )

    save_spotify_tokens()


def get_spotify_headers():
    access_token = spotify_tokens.get(
        "access_token"
    )

    if not access_token:
        refresh_spotify_access_token()

        access_token = spotify_tokens.get(
            "access_token"
        )

    return {
        "Authorization":
            f"Bearer {access_token}",
    }


def spotify_request(
    method: str,
    url: str,
    **kwargs,
):
    headers = get_spotify_headers()

    extra_headers = kwargs.pop(
        "headers",
        {},
    )

    response = requests.request(
        method,
        url,
        headers={
            **headers,
            **extra_headers,
        },
        timeout=15,
        **kwargs,
    )

    # Access token expired.
    # Refresh once and retry.
    if response.status_code == 401:
        refresh_spotify_access_token()

        headers = get_spotify_headers()

        response = requests.request(
            method,
            url,
            headers={
                **headers,
                **extra_headers,
            },
            timeout=15,
            **kwargs,
        )

    return response



@app.get("/spotify/current")
def spotify_current():
    response = spotify_request(
        "GET",
        "https://api.spotify.com/v1/me/player/currently-playing",
    )

    if response.status_code == 204:
        return {
            "playing": False,
            "track": None,
            "artist": None,
        }

    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    data = response.json()
    item = data.get("item")

    return {
        "playing": data.get("is_playing", False),
        "track": item.get("name") if item else None,
        "artist": (
            item["artists"][0]["name"]
            if item and item.get("artists")
            else None
        ),
        "uri": item.get("uri") if item else None,
    }

# --------------------------------------------------
# Spotify Login
# --------------------------------------------------

@app.get("/spotify/login")
def spotify_login():
    if not SPOTIFY_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="SPOTIFY_CLIENT_ID is missing.",
        )

    if not SPOTIFY_REDIRECT_URI:
        raise HTTPException(
            status_code=500,
            detail="SPOTIFY_REDIRECT_URI is missing.",
        )

    params = {
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": (
            "user-modify-playback-state "
            "user-read-playback-state"
        ),
    }

    url = (
        "https://accounts.spotify.com/authorize?"
        + urlencode(params)
    )

    return RedirectResponse(url)


# --------------------------------------------------
# Spotify OAuth Callback
# --------------------------------------------------

@app.get("/spotify/callback")
def spotify_callback(code: str):
    if not SPOTIFY_REDIRECT_URI:
        raise HTTPException(
            status_code=500,
            detail="SPOTIFY_REDIRECT_URI is missing.",
        )

    response = requests.post(
        "https://accounts.spotify.com/api/token",
        headers=get_basic_auth_header(),
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": SPOTIFY_REDIRECT_URI,
        },
        timeout=15,
    )

    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    data = response.json()

    spotify_tokens["access_token"] = (
        data["access_token"]
    )

    spotify_tokens["refresh_token"] = (
        data.get("refresh_token")
    )

    save_spotify_tokens()

    return {
        "connected": True,
        "message": (
            "Spotify connected successfully. "
            "You can close this tab."
        ),
    }


# --------------------------------------------------
# Spotify Status
# --------------------------------------------------

@app.get("/spotify/status")
def spotify_status():
    return {
        "connected":
            spotify_tokens["access_token"]
            is not None,
        "has_refresh_token":
            spotify_tokens["refresh_token"]
            is not None,
    }


# --------------------------------------------------
# Spotify Devices
# --------------------------------------------------

@app.get("/spotify/devices")
def spotify_devices():
    response = spotify_request(
        "GET",
        "https://api.spotify.com/v1/me/player/devices",
    )

    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    return response.json()


# --------------------------------------------------
# Get Spotify Device
# --------------------------------------------------

def get_spotify_device():
    response = spotify_request(
        "GET",
        "https://api.spotify.com/v1/me/player/devices",
    )

    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    devices = response.json().get(
        "devices",
        [],
    )

    if not devices:
        raise HTTPException(
            status_code=404,
            detail=(
                "No Spotify device available. "
                "Open Spotify on your Mac or phone."
            ),
        )

    active_device = next(
        (
            device
            for device in devices
            if device.get("is_active")
        ),
        devices[0],
    )

    device_id = active_device.get("id")

    if not device_id:
        raise HTTPException(
            status_code=500,
            detail=(
                "Spotify device has no device ID."
            ),
        )

    return active_device


# --------------------------------------------------
# Spotify Play
# --------------------------------------------------

@app.post("/spotify/play")
def spotify_play(request: SpotifyPlayRequest):
    device = get_spotify_device()

    device_id = device["id"]

    search_response = spotify_request(
        "GET",
        "https://api.spotify.com/v1/search",
        params={
            "q": request.query,
            "type": "track",
            "limit": 10,
        },
    )

    if not search_response.ok:
        raise HTTPException(
            status_code=search_response.status_code,
            detail=search_response.text,
        )

    data = search_response.json()

    tracks = (
        data
        .get("tracks", {})
        .get("items", [])
    )

    if not tracks:
        raise HTTPException(
            status_code=404,
            detail=f"No track found for '{request.query}'.",
        )

    track = tracks[0]

    track_uris = [
        item["uri"]
        for item in tracks
    ]

    play_response = spotify_request(
        "PUT",
        "https://api.spotify.com/v1/me/player/play",
        headers={
            "Content-Type": "application/json",
        },
        params={
            "device_id": device_id,
        },
        json={
            "uris": track_uris,
        },
    )

    if play_response.status_code not in (
        200,
        204,
    ):
        raise HTTPException(
            status_code=play_response.status_code,
            detail=play_response.text,
        )

    return {
        "playing": True,
        "track": track["name"],
        "artist": track["artists"][0]["name"],
        "uri": track["uri"],
        "device": device["name"],
        "queue_size": len(track_uris),
    }
# --------------------------------------------------
# Spotify Next Track
# --------------------------------------------------

@app.post("/spotify/next")
def spotify_next():
    device = get_spotify_device()

    response = spotify_request(
        "POST",
        "https://api.spotify.com/v1/me/player/next",
        params={
            "device_id": device["id"],
        },
    )

    if response.status_code not in (
        200,
        204,
    ):
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    return {
        "success": True,
        "message": "Skipped to next track.",
        "device": device["name"],
    }


# --------------------------------------------------
# Spotify Pause
# --------------------------------------------------

@app.post("/spotify/pause")
def spotify_pause():
    device = get_spotify_device()

    response = spotify_request(
        "PUT",
        "https://api.spotify.com/v1/me/player/pause",
        params={
            "device_id": device["id"],
        },
    )

    if response.status_code not in (
        200,
        204,
    ):
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    return {
        "success": True,
        "message": "Spotify paused.",
    }


# --------------------------------------------------
# Spotify Resume
# --------------------------------------------------

@app.post("/spotify/resume")
def spotify_resume():
    device = get_spotify_device()

    response = spotify_request(
        "PUT",
        "https://api.spotify.com/v1/me/player/play",
        params={
            "device_id": device["id"],
        },
    )

    if response.status_code not in (
        200,
        204,
    ):
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    return {
        "success": True,
        "message": "Spotify resumed.",
    }


# --------------------------------------------------
# Health Check
# --------------------------------------------------

@app.get("/")
def root():
    return {
        "status": "ok",
        "kokoro": True,
        "spotify_connected":
            spotify_tokens["access_token"]
            is not None,
    }